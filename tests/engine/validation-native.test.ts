import { expect, it } from 'vitest'
import { runNativeMigrationDrill } from '../harness/native-migrations.ts'
it.skipIf(process.env.FORGE_NATIVE_MIGRATION_TEST !== '1')('runs reviewed synthetic SQL in a fresh native PostgreSQL cluster with limited roles (not isolated runner evidence)', () => {
  const result = runNativeMigrationDrill()
  expect(result).toMatchObject({ origin: 'native-postgres-synthetic', fresh: true, priorSeeded: true, limitedRole: true, cleanup: true })
}, 60000)
