import { authPool as pool } from './database'

// Shared database limits bound the whole installation, including requests with
// spoofed/missing proxy IP headers. These conservative initial limits are not
// a per-user fairness or capacity guarantee. Keys are fixed, never email/IP data.
export async function admitAuthRequest(path: string): Promise<number | null> {
  const rules: [string, number, number][] = [['all', 60, 200]]
  if (path === '/api/auth/sign-up/email') rules.push(['signup', 3600, 20])
  if (
    [
      '/api/auth/sign-up/email',
      '/api/auth/request-password-reset',
      '/api/auth/send-verification-email',
    ].includes(path)
  )
    rules.push(['email', 3600, 30])
  if (path === '/api/auth/sign-in/email') rules.push(['login', 60, 60])
  for (const [key, window, limit] of rules) {
    const result = await pool().query(
      `
      INSERT INTO forge_auth_admission(key,window_start,attempts)
      VALUES($1,clock_timestamp(),1)
      ON CONFLICT(key) DO UPDATE SET
        window_start=CASE WHEN forge_auth_admission.window_start <= clock_timestamp()-$2*interval '1 second'
          THEN clock_timestamp() ELSE forge_auth_admission.window_start END,
        attempts=CASE WHEN forge_auth_admission.window_start <= clock_timestamp()-$2*interval '1 second'
          THEN 1 ELSE forge_auth_admission.attempts+1 END
      WHERE forge_auth_admission.window_start <= clock_timestamp()-$2*interval '1 second'
        OR forge_auth_admission.attempts < $3
      RETURNING key`,
      [key, window, limit]
    )
    if (!result.rowCount) return window
  }
  return null
}
