import { createHash } from 'node:crypto'
import { emptyOnboarding, HttpError, projectInput, parse } from './contracts.mjs'

const record = (r) => ({
  ...r.brief,
  id: r.id,
  revision: r.revision,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
})
export class CloudStore {
  constructor(pool) {
    this.pool = pool
  }
  async run(userId, action) {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query(
        "SELECT set_config('forge.user_id',$1,true),set_config('statement_timeout','5000',true)",
        [userId]
      )
      const identity = await c.query(
        'SELECT id FROM neon_auth."user" WHERE id=$1 AND "emailVerified"=true AND coalesce(banned,false)=false',
        [userId]
      )
      if (!identity.rowCount)
        throw new HttpError(401, 'Sign in with a verified account to continue.')
      await c.query(
        'INSERT INTO forge.profiles(user_id,onboarding) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [userId, emptyOnboarding]
      )
      await c.query('INSERT INTO forge.workspaces(owner_id) VALUES($1) ON CONFLICT DO NOTHING', [
        userId,
      ])
      const {
        rows: [workspace],
      } = await c.query('SELECT id FROM forge.workspaces WHERE owner_id=$1', [userId])
      await c.query(
        'INSERT INTO forge.memberships(workspace_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [workspace.id, userId]
      )
      const result = await action(c, workspace.id)
      await c.query('COMMIT')
      return result
    } catch (error) {
      await c.query('ROLLBACK')
      throw error
    } finally {
      c.release()
    }
  }
  async onboarding(userId, input) {
    return this.run(userId, async (c) => {
      if (input) {
        const { revision, ...next } = input
        const result = await c.query(
          'UPDATE forge.profiles SET onboarding=onboarding || $2::jsonb,revision=revision+1 WHERE user_id=$1 AND revision=$3 RETURNING user_id',
          [userId, next, revision]
        )
        if (!result.rowCount)
          throw new HttpError(409, 'Your progress changed on another device. Reload before saving.')
      }
      const {
        rows: [p],
      } = await c.query('SELECT onboarding,revision FROM forge.profiles WHERE user_id=$1', [userId])
      return { ...p.onboarding, revision: p.revision }
    })
  }
  async complete(userId, expectedRevision) {
    return this.run(userId, async (c, wid) => {
      const {
        rows: [p],
      } = await c.query(
        'SELECT onboarding,revision FROM forge.profiles WHERE user_id=$1 FOR UPDATE',
        [userId]
      )
      if (p.onboarding.completedAt) return p.onboarding
      if (p.revision !== expectedRevision)
        throw new HttpError(409, 'Your progress changed. Reload before creating the project.')
      const d = p.onboarding.draft
      const brief = parse(projectInput, {
        name: d.name,
        prompt: `Audience: ${d.audience}\nOutcome: ${d.outcome}\nCore features: ${d.features}`,
        template: 'Next.js + Postgres',
        presetId: d.presetId,
      })
      if (!d.audience.trim() || !d.outcome.trim() || !d.features.trim())
        throw new HttpError(422, 'Complete your idea before creating a project.')
      const {
        rows: [created],
      } = await c.query(
        'INSERT INTO forge.projects(workspace_id,brief) VALUES($1,$2) RETURNING id',
        [wid, brief]
      )
      const next = {
        ...p.onboarding,
        stage: 3,
        completedAt: new Date().toISOString(),
        projectId: created.id,
      }
      await c.query(
        'UPDATE forge.profiles SET onboarding=$2,revision=revision+1 WHERE user_id=$1',
        [userId, next]
      )
      return next
    })
  }
  async startGuided(userId, expectedRevision) {
    return this.run(userId, async (c) => {
      const {
        rows: [p],
      } = await c.query(
        'SELECT onboarding,revision FROM forge.profiles WHERE user_id=$1 FOR UPDATE',
        [userId]
      )
      if (p.revision !== expectedRevision)
        throw new HttpError(409, 'Your progress changed. Reload before starting another project.')
      // An unfinished guide is resumed, never silently discarded.
      if (!p.onboarding.completedAt) return { ...p.onboarding, revision: p.revision }
      const next = {
        ...emptyOnboarding,
        firstCompletedAt: p.onboarding.firstCompletedAt || p.onboarding.completedAt,
      }
      await c.query(
        'UPDATE forge.profiles SET onboarding=$2,revision=revision+1 WHERE user_id=$1',
        [userId, next]
      )
      return { ...next, revision: p.revision + 1 }
    })
  }
  async list(userId, { offset = 0, search = '', deleted = false } = {}) {
    return this.run(userId, async (c, wid) => {
      const { rows } = await c.query(
        "SELECT * FROM forge.projects WHERE workspace_id=$1 AND (deleted_at IS NOT NULL)=$2 AND position(lower($3) in lower(brief->>'name'))>0 ORDER BY updated_at DESC,id LIMIT 51 OFFSET $4",
        [wid, deleted, search, offset]
      )
      return {
        projects: rows.slice(0, 50).map(record),
        nextOffset: rows.length > 50 ? offset + 50 : null,
      }
    })
  }
  async create(userId, brief) {
    return this.run(userId, async (c, wid) =>
      record(
        (
          await c.query(
            'INSERT INTO forge.projects(workspace_id,brief) VALUES($1,$2) RETURNING *',
            [wid, brief]
          )
        ).rows[0]
      )
    )
  }
  async mutate(userId, id, op, input) {
    return this.run(userId, async (c, wid) => {
      const {
        rows: [p],
      } = await c.query('SELECT * FROM forge.projects WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
        id,
        wid,
      ])
      if (!p) throw new HttpError(404, 'Project not found.')
      if (op === 'get') return record(p)
      if (input.revision !== p.revision)
        throw new HttpError(
          409,
          'This project changed on another device. Reload to review the latest version.'
        )
      if (op === 'duplicate')
        return record(
          (
            await c.query(
              'INSERT INTO forge.projects(workspace_id,brief) VALUES($1,$2) RETURNING *',
              [wid, { ...p.brief, name: p.brief.name.slice(0, 90) + ' copy' }]
            )
          ).rows[0]
        )
      const {
        rows: [updated],
      } = await c.query(
        'UPDATE forge.projects SET brief=$3,deleted_at=$4,revision=revision+1,updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING *',
        [
          id,
          wid,
          op === 'edit' ? input.brief : p.brief,
          op === 'delete' ? new Date() : op === 'restore' ? null : p.deleted_at,
        ]
      )
      return record(updated)
    })
  }
  async import(userId, projects) {
    return this.run(userId, async (c, wid) => {
      let imported = 0
      for (const p of projects) {
        const brief = parse(projectInput, {
          name: p.name,
          prompt: p.prompt,
          template: p.template,
          presetId: p.presetId,
        })
        const key = createHash('sha256')
          .update(JSON.stringify([p.id, brief]))
          .digest('hex')
        const result = await c.query(
          'INSERT INTO forge.projects(workspace_id,brief,import_key) VALUES($1,$2,$3) ON CONFLICT(workspace_id,import_key) DO NOTHING',
          [wid, brief, key]
        )
        imported += result.rowCount
      }
      return { imported, skipped: projects.length - imported }
    })
  }
  async export(userId) {
    return this.run(userId, async (c, wid) => ({
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: (await c.query('SELECT onboarding FROM forge.profiles WHERE user_id=$1', [userId]))
        .rows[0],
      projects: (
        await c.query('SELECT * FROM forge.projects WHERE workspace_id=$1 ORDER BY id', [wid])
      ).rows.map(record),
    }))
  }
}
