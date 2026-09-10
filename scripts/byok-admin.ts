import { randomUUID } from 'node:crypto'
import { ConnectionStore } from '../src/server/byok/store'
import { credentialBinding, vault } from '../src/server/byok/vault'
import { providerDefaults } from '../src/shared/byok'
import type { ConnectionRow } from '../src/server/byok/store'
const command = process.argv[2]
const store = new ConnectionStore(),
  owner = process.env.FORGE_LOCAL_OWNER_ID ?? 'local-owner'
try {
  if (command === 'import-env') {
    if (process.env.FORGE_AUTH_MODE === 'hosted')
      throw new Error('Environment references cannot be imported into hosted user accounts.')
    await store.transaction({ id: owner, local: true }, async (tx) => {
      for (const [provider, keyName, modelName] of [
        ['openai', 'OPENAI_API_KEY', 'OPENAI_MODEL'],
        ['anthropic', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
        ['deepseek', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL'],
        ['gemini', 'GEMINI_API_KEY', 'GEMINI_MODEL'],
        ['groq', 'GROQ_API_KEY', 'GROQ_MODEL'],
        ['openrouter', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'],
      ] as const) {
        if (!process.env[keyName]) continue
        const prior = await tx.query(
          'SELECT id FROM forge_connections WHERE owner_id=$1 AND secret_ref=$2 AND NOT deleted',
          [owner, keyName]
        )
        if (prior.rowCount) continue
        const model = process.env[modelName],
          defaults = providerDefaults[provider]
        const models = model
          ? [
              {
                id: model,
                name: model,
                contextWindow: 32768,
                maxOutputTokens: 8192,
                capabilities: {
                  text: true,
                  structured: true,
                  research: provider === 'openai',
                  streaming: provider !== 'gemini',
                },
                verified: [],
              },
            ]
          : []
        await tx.query(
          'INSERT INTO forge_connections(id,owner_id,label,provider,protocol,base_url,secret_ref,models) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            randomUUID(),
            owner,
            provider + ' · local server reference',
            provider,
            defaults.protocol,
            defaults.baseUrl,
            keyName,
            JSON.stringify(models),
          ]
        )
      }
    })
    console.log(
      'Local environment references imported. Discover and test models before assigning tasks.'
    )
  } else if (command === 'reencrypt') {
    const id = process.argv[3]
    if (!id) throw new Error('Supply the owner ID for keyring rotation.')
    await store.transaction({ id, local: true }, async (tx) => {
      const rows = await tx.query<ConnectionRow>(
        'SELECT * FROM forge_connections WHERE owner_id=$1 AND envelope IS NOT NULL FOR UPDATE',
        [id]
      )
      const cipher = vault()
      for (const row of rows.rows) {
        const raw = await cipher.decrypt(credentialBinding(row), row.envelope!)
        // Rewrapping does not change the provider credential revision or invalidate runs.
        const envelope = await cipher.encrypt(credentialBinding(row), raw)
        await tx.query('UPDATE forge_connections SET envelope=$3 WHERE owner_id=$1 AND id=$2', [
          id,
          row.id,
          envelope,
        ])
      }
    })
    console.log('Credential ciphertext re-encrypted with the active keyring version.')
  } else if (command === 'recover-tests') {
    await store.transaction({ id: owner, local: true }, async (tx) => {
      await tx.query(
        "UPDATE forge_model_attempts SET status='unknown',error_code='TEST_INTERRUPTED' WHERE owner_id=$1 AND status='dispatched' AND dispatched_at<now()-interval '3 minutes' AND run_id IN (SELECT id FROM forge_model_runs WHERE owner_id=$1 AND job_id IS NULL)",
        [owner]
      )
    })
    console.log(
      'Stale local diagnostics marked unknown. Their reserved liability remains retained.'
    )
  } else throw new Error('Use import-env, reencrypt OWNER_ID, or recover-tests.')
} catch (error) {
  console.error(
    error instanceof Error && !error.message.includes('://')
      ? error.message
      : 'BYOK administration failed.'
  )
  process.exitCode = 1
} finally {
  await store.database.end()
}
