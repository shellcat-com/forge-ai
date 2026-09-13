import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { HttpError } from './contracts.mjs'
import { generate, providerConfig, ProviderError } from '../provider.mjs'

export const connectionProviders = ['deepseek', 'nvidia']
export const dailyRequestLimit = 20

// The encryption key is supplied by the host's secret manager, separately from PostgreSQL.
export function createKeyVault(secret) {
  if (!/^[0-9a-f]{64}$/i.test(secret || ''))
    throw new Error('A 32-byte provider encryption key is required.')
  const key = Buffer.from(secret, 'hex')
  const aad = (user, provider) => Buffer.from(JSON.stringify(['forge-provider-v1', user, provider]))
  return {
    seal(user, provider, value) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(aad(user, provider))
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return [
        'v1',
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        encrypted.toString('base64url'),
      ].join('.')
    },
    open(user, provider, value) {
      const [version, iv, tag, data, extra] = value.split('.')
      if (version !== 'v1' || !iv || !tag || !data || extra)
        throw new Error('Invalid key envelope.')
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
      decipher.setAAD(aad(user, provider))
      decipher.setAuthTag(Buffer.from(tag, 'base64url'))
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8')
    },
  }
}

export class ProviderConnections {
  constructor({ store, encryptionKey, fetchImpl = fetch, timeoutMs = 120000 }) {
    this.store = store
    this.vault = createKeyVault(encryptionKey)
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }
  async configuration(user) {
    return this.store.run(user, async (c) => {
      const { rows } = await c.query(
        'SELECT provider,fingerprint,checked_at FROM forge.provider_connections WHERE user_id=$1',
        [user]
      )
      const {
        rows: [usage],
      } = await c.query(
        "SELECT count(*)::int AS requests FROM forge.provider_requests WHERE user_id=$1 AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
        [user]
      )
      return {
        enabled: true,
        dailyLimit: dailyRequestLimit,
        requestsToday: usage.requests,
        providers: connectionProviders.map((id) => {
          const saved = rows.find((row) => row.provider === id)
          const config = providerConfig(id)
          return {
            id,
            name: config.name,
            models: config.models,
            connected: Boolean(saved),
            fingerprint: saved?.fingerprint || null,
            checkedAt: saved?.checked_at || null,
          }
        }),
      }
    })
  }
  async reserve(user, requestId) {
    return this.store.run(user, async (c) => {
      // Serialize per-account reservations across every process/replica.
      await c.query('SELECT user_id FROM forge.profiles WHERE user_id=$1 FOR UPDATE', [user])
      const {
        rows: [budget],
      } = await c.query(
        "SELECT count(*) FILTER (WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS used, count(*) FILTER (WHERE lease_until > now())::int AS active, count(*) FILTER (WHERE request_id=$2)::int AS repeated FROM forge.provider_requests WHERE user_id=$1",
        [user, requestId]
      )
      if (budget.repeated)
        throw new HttpError(
          409,
          'This request was already submitted. It will not be charged again by Forge.'
        )
      if (budget.active)
        throw new HttpError(
          429,
          'A provider request is already running for your account. Wait for it to finish.'
        )
      if (budget.used >= dailyRequestLimit)
        throw new HttpError(429, 'Your daily request limit is reached. It resets at midnight UTC.')
      await c.query(
        "INSERT INTO forge.provider_requests(user_id,request_id,lease_until) VALUES($1,$2,now()+interval '3 minutes')",
        [user, requestId]
      )
    })
  }
  async request(user, requestId, signal, action) {
    await this.reserve(user, requestId)
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    const timer = setTimeout(abort, this.timeoutMs)
    try {
      return await action(controller.signal)
    } catch (error) {
      if (controller.signal.aborted)
        throw new HttpError(
          504,
          'The provider request timed out or was cancelled. Check your provider usage before trying again.'
        )
      if (error instanceof HttpError) throw error
      if (error instanceof ProviderError) throw new HttpError(error.status, error.message)
      throw new HttpError(
        502,
        'The provider could not complete this request. Your saved key and brief are unchanged.'
      )
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      // If the database is unavailable, the bounded lease expires without allowing parallel calls.
      await this.store
        .run(user, (c) =>
          c.query(
            'UPDATE forge.provider_requests SET lease_until=NULL WHERE user_id=$1 AND request_id=$2',
            [user, requestId]
          )
        )
        .catch(() => {})
    }
  }
  async save(user, provider, key, requestId, signal) {
    return this.request(user, requestId, signal, async (requestSignal) => {
      // An authenticated completion proves access; a public model listing does not.
      await generate({
        provider,
        key,
        model: providerConfig(provider).models[0].id,
        name: 'Connection check',
        template: 'Connection check',
        prompt: 'Reply with OK.',
        maxTokens: 32,
        fetchImpl: this.fetchImpl,
        signal: requestSignal,
      })
      const ciphertext = this.vault.seal(user, provider, key)
      const fingerprint = createHash('sha256').update(key).digest('hex').slice(0, 12)
      await this.store.run(user, (c) =>
        c.query(
          'INSERT INTO forge.provider_connections(user_id,provider,ciphertext,fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,provider) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,fingerprint=EXCLUDED.fingerprint,checked_at=now()',
          [user, provider, ciphertext, fingerprint]
        )
      )
      return { connected: true, provider, fingerprint }
    })
  }
  async remove(user, provider) {
    await this.store.run(user, (c) =>
      c.query('DELETE FROM forge.provider_connections WHERE user_id=$1 AND provider=$2', [
        user,
        provider,
      ])
    )
    return { removed: true }
  }
  async run(user, brief, input, signal) {
    const config = providerConfig(input.provider)
    if (!config.models.some((model) => model.id === input.model))
      throw new HttpError(422, 'Choose an available model.')
    return this.request(user, input.requestId, signal, async (requestSignal) => {
      const row = await this.store.run(
        user,
        async (c) =>
          (
            await c.query(
              'SELECT ciphertext FROM forge.provider_connections WHERE user_id=$1 AND provider=$2',
              [user, input.provider]
            )
          ).rows[0]
      )
      if (!row) throw new HttpError(409, 'Connect this provider in Settings before generating.')
      const key = this.vault.open(user, input.provider, row.ciphertext)
      return generate({
        ...brief,
        provider: input.provider,
        model: input.model,
        mode: input.mode,
        maxTokens: input.mode === 'website' ? 8000 : 2048,
        key,
        signal: requestSignal,
        fetchImpl: this.fetchImpl,
      })
    })
  }
}
