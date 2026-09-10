import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sha256 } from '../../engine/contracts/canonical.ts'
import { assessDeliveryEvidence, verifyDeliveryArtifacts } from '../../engine/validation/delivery-evidence.ts'

// Entirely synthetic test inputs. Even records labeled live are not receipts.
const identity = () => ({ controlCommit: 'a'.repeat(40), sourceDigest: sha256('source'),
  templateDigest: sha256('template'), policyDigest: sha256('policy'), runtimeDigest: sha256('runtime'),
  deploymentDigest: sha256('deployment') })
const bundle = () => ({ schemaVersion: 1, expected: identity(), records: [{
  id: 'synthetic-receipt', runId: 'attempt-1', identity: identity(), origin: 'live', status: 'passed',
  scenario: 'A19', artifactPath: 'result.json', artifactDigest: sha256('{}'),
  controls: { zoom: 'native-browser-200', motion: 'native-setting', anonymous: true },
}] })

it.each(['controlCommit', 'sourceDigest', 'templateDigest', 'policyDigest', 'runtimeDigest', 'deploymentDigest'] as const)(
  'rejects a passing receipt bound to stale %s', key => {
    const input = bundle()
    input.records[0].identity[key] = key === 'controlCommit' ? 'b'.repeat(40) : sha256('stale')
    const result = assessDeliveryEvidence(input)
    expect(result.records[0].eligibleForAttestationReview).toBe(false)
    expect(result.records[0].reasons).toContain(`identity-mismatch:${key}`)
  })
it('never turns a matching digest or self-declared live record into trusted release authority', () => {
  expect(assessDeliveryEvidence(bundle())).toMatchObject({ provenanceVerified: false,
    releaseReady: false, dispatchAuthorized: false,
    records: [{ eligibleForAttestationReview: true }] })
})
it('requires complete live identities and keeps scaffold/fixture checks supporting only', () => {
  const input = bundle()
  const noRuntime = { ...input, expected: { ...input.expected, runtimeDigest: null },
    records: input.records.map(record => ({ ...record, identity: { ...record.identity, runtimeDigest: null } })) }
  expect(assessDeliveryEvidence(noRuntime).records[0].reasons).toContain('incomplete-live-identity')
  for (const origin of ['fixture', 'platform-scaffold', 'repository', 'native-postgres-synthetic']) {
    input.records[0].origin = origin
    expect(assessDeliveryEvidence(input).records[0].eligibleForAttestationReview).toBe(false)
  }
})
it('does not count CSS zoom or media emulation as actual browser/OS controls', () => {
  const input = bundle()
  input.records[0].controls.zoom = 'css-simulation'
  input.records[0].controls.motion = 'media-emulation'
  expect(assessDeliveryEvidence(input).records[0].reasons).toEqual([
    'native-zoom-not-observed', 'native-motion-not-observed',
  ])
})
it('requires an anonymous portfolio observation, not an owner login', () => {
  const input = bundle(); input.records[0].scenario = 'PORTFOLIO'
  input.records[0].controls.anonymous = false
  expect(assessDeliveryEvidence(input).records[0].reasons).toContain('anonymous-visit-not-observed')
  const missing = { ...input, expected: { ...input.expected, deploymentDigest: null },
    records: input.records.map(record => ({ ...record, identity: { ...record.identity, deploymentDigest: null } })) }
  expect(assessDeliveryEvidence(missing).records[0].reasons).toContain('deployment-identity-missing')
})
it('retains failed attempts including failures from stale identities', () => {
  const input = bundle(); input.records[0].status = 'failed'
  input.records[0].identity.sourceDigest = sha256('earlier-source')
  expect(assessDeliveryEvidence(input)).toMatchObject({ attempts: 1, failures: 1,
    records: [{ status: 'failed', eligibleForAttestationReview: false }] })
})
it('rejects duplicate receipts/attempts and unknown evidence fields', () => {
  const input = bundle(); input.records.push(structuredClone(input.records[0]))
  expect(() => assessDeliveryEvidence(input)).toThrow('Duplicate')
  input.records[1].id = 'another-id'
  expect(() => assessDeliveryEvidence(input)).toThrow('Duplicate scenario attempt')
  expect(() => assessDeliveryEvidence({ ...bundle(), releaseReady: true })).toThrow()
})
it('verifies bytes and rejects tampering, missing files, traversal and external symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-delivery-proof-'))
  const outside = await mkdtemp(join(tmpdir(), 'forge-delivery-outside-'))
  try {
    const input = bundle()
    await writeFile(join(root, 'result.json'), '{}')
    expect(await verifyDeliveryArtifacts(input, root)).toMatchObject({ verifiedArtifactCount: 1, releaseReady: false })
    await writeFile(join(root, 'result.json'), '{"tampered":true}')
    await expect(verifyDeliveryArtifacts(input, root)).rejects.toThrow('EVIDENCE_HASH_MISMATCH')
    input.records[0].artifactPath = 'missing.json'
    await expect(verifyDeliveryArtifacts(input, root)).rejects.toThrow()
    input.records[0].artifactPath = '../outside.json'
    await expect(verifyDeliveryArtifacts(input, root)).rejects.toThrow()
    await writeFile(join(outside, 'private.json'), '{}')
    await symlink(join(outside, 'private.json'), join(root, 'link.json'))
    input.records[0].artifactPath = 'link.json'
    await expect(verifyDeliveryArtifacts(input, root)).rejects.toThrow('EVIDENCE_PATH_ESCAPE')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
