/** Cross-task native acceptance. Explicit path points to Task 05's owned module;
 * imports it read-only. Never applies identity migrations or connects cloud DB. */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createPreviewHarness } from '../harness/preview.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'
const modulePath = process.argv[2]
if (!modulePath?.startsWith('/'))
  throw new Error('Absolute reviewed Task 05 identity-operator.ts path required')
const { IdentityOperator } = await import(pathToFileURL(modulePath).href)
const h = await createPreviewHarness()
try {
  const p = await h.ready(),
    owner = await h.actor()
  await h.db.admin.query(
    "INSERT INTO forge_control.memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",
    [p.actor.workspace, owner.id]
  )
  const session = await h.preview.consume((await p.issue()).ticket, p.host),
    ticket = await p.issue()
  const operator = new IdentityOperator(h.db.admin, new URL(h.identity.issuer).href)
  const lock = await h.db.api.pool.connect()
  try {
    await lock.query('BEGIN')
    await lock.query('SET LOCAL ROLE forge_control_api')
    await lock.query('SET LOCAL search_path=forge_control,pg_catalog')
    await lock.query('SELECT authorize_preview($1,$2,NULL)', [sha256(session.token), p.host])
    const revoked = operator.revoke({
      operatorId: randomUUID(),
      requestId: randomUUID(),
      workspaceId: p.actor.workspace,
      userId: p.actor.id,
    })
    const consume = h.preview.consume(ticket.ticket, p.host).then(
      (value) => ({ value }),
      (error) => ({ error })
    )
    const renew = h.preview.renew(session.token, p.host).then(
      (value) => ({ value }),
      (error) => ({ error })
    )
    await delay(100)
    await lock.query('COMMIT')
    await revoked
    for (const r of await Promise.all([consume, renew])) {
      if ('error' in r) assert(!['40P01', '55P03', '57014'].includes(r.error.code))
      if ('value' in r) await assert.rejects(h.preview.authorize(r.value.token, p.host))
    }
    await assert.rejects(h.preview.authorize(session.token, p.host))
  } finally {
    await lock.query('ROLLBACK')
    lock.release()
  }
  // Exhaust the bounded NOWAIT retries; the operator must leave membership/login intact.
  const q = await h.ready('retry.vercel.app'),
    second = await h.actor()
  await h.db.admin.query(
    "INSERT INTO forge_control.memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",
    [q.actor.workspace, second.id]
  )
  const qSession = await h.preview.consume((await q.issue()).ticket, q.host)
  const held = await h.db.api.pool.connect()
  try {
    await held.query('BEGIN')
    await held.query('SET LOCAL ROLE forge_control_api')
    await held.query('SET LOCAL search_path=forge_control,pg_catalog')
    await held.query('SELECT authorize_preview($1,$2,NULL)', [sha256(qSession.token), q.host])
    await assert.rejects(
      operator.revoke({
        operatorId: randomUUID(),
        requestId: randomUUID(),
        workspaceId: q.actor.workspace,
        userId: q.actor.id,
      }),
      /IDENTITY_OPERATOR_BUSY_RETRY/
    )
    await held.query('COMMIT')
    assert.equal((await h.preview.authorize(qSession.token, q.host)).userId, q.actor.id)
  } finally {
    await held.query('ROLLBACK')
    held.release()
  }
  const evidence = {
    outcome: 'PASS',
    evidence:
      'native PostgreSQL; fixture identities and runtime; Task05 operator real implementation',
    database: h.db.version,
    tests: [
      'operator revocation versus held preview authorization, consume and renewal',
      'exhausted NOWAIT retries roll back without membership/session mutation',
    ],
    identityOperatorSha256: createHash('sha256')
      .update(await readFile(modulePath))
      .digest('hex'),
  }
  await mkdir('docs/reports/demo-delivery/evidence-task-07', { recursive: true })
  await writeFile(
    'docs/reports/demo-delivery/evidence-task-07/identity-race.json',
    JSON.stringify(evidence, null, 2) + '\n'
  )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await h.close()
}
