export type ThemePreference = 'system' | 'light' | 'dark'
export const themeKey = 'forge.theme'
export function validTheme(value: unknown): value is ThemePreference {
  return ['system', 'light', 'dark'].includes(String(value))
}
export function resolveTheme(preference: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}
export function readTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(themeKey)
    return validTheme(value) ? value : 'system'
  } catch {
    return 'system'
  }
}
export function applyTheme(preference = readTheme()): boolean {
  document.documentElement.dataset.theme = resolveTheme(
    preference,
    matchMedia('(prefers-color-scheme: dark)').matches
  )
  try {
    localStorage.setItem(themeKey, preference)
    return true
  } catch {
    return false
  }
}
