import { tsImport } from 'tsx/esm/api'

// Standalone read-only CLI; no listener, migrations, provider calls or job admission.
const deadline = setTimeout(() => {
  console.error('Hosted foundation preflight timed out; release acceptance remains unverified.')
  process.exit(1)
}, 60000)
try {
  const { runHostedReadiness, readinessExitCode } = await tsImport('./check-hosted-readiness.ts', {
    parentURL: import.meta.url,
    tsconfig: false,
  })
  const result = await runHostedReadiness()
  console.log(JSON.stringify(result, null, 2))
  // 2: foundation passed, but live release acceptance was NOT evaluated.
  // Never return a release-success code from a configuration-only check.
  process.exitCode = readinessExitCode(result)
} catch {
  console.error(
    'Hosted foundation preflight unavailable. Check Node 24, npm ci and private server configuration; diagnostics are redacted.'
  )
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
}
