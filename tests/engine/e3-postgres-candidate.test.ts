import { expect, it } from 'vitest'
import { checkCandidatePostgres } from '../harness/candidate-postgres.ts'

it.skipIf(process.env.FORGE_POSTGRES18_CANDIDATE_TEST !== '1')('checks actual pinned bootstrap on local PostgreSQL18.6 with reviewed synthetic SQL, never guest acceptance', () => {
  const result = checkCandidatePostgres()
  expect(result).toMatchObject({ version: 'postgres (PostgreSQL) 18.6', fresh: true, priorSeeded: true,
    defaultPrivileges: true, restrictedRoles: true, databaseRestart: true, cleanup: true, isolationAcceptance: false })
  console.info(JSON.stringify(result))
}, 60_000)
