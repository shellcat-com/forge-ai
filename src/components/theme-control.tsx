'use client'
import { useEffect, useState } from 'react'
import { applyTheme, readTheme } from '../theme'
import type { ThemePreference } from '../theme'
export function ThemeControl() {
  const [selected, setSelected] = useState<ThemePreference>('system')
  useEffect(() => {
    setSelected(readTheme())
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => applyTheme(readTheme())
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return (
    <div className="theme-switch" role="group" aria-label="Appearance">
      {(['system', 'light', 'dark'] as const).map((t, i) => (
        <button
          key={t}
          aria-label={`${t[0].toUpperCase() + t.slice(1)} theme`}
          aria-pressed={selected === t}
          onClick={() => {
            setSelected(t)
            applyTheme(t)
          }}
        >
          {['▣', '☼', '☾'][i]}
        </button>
      ))}
    </div>
  )
}
