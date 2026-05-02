import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../supabase'
import { ThemeContext, THEMES, DEFAULT_THEME, type ThemeId } from './themes'

function isValidTheme(value: unknown): value is ThemeId {
  return value === 'theme1' || value === 'theme2' || value === 'theme3'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME)

  // The theme is applied via `data-theme` on the PublicLayout wrapper (see
  // PublicLayout.tsx) so it scopes to the public-facing site only and the
  // admin console always renders in the stable default palette. We
  // intentionally do NOT set the attribute on documentElement here.

  // Fetch the admin-controlled theme once on mount and apply it for everyone.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('admin_settings')
      .select('theme')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (cancelled) return
        if (data && isValidTheme(data.theme)) setTheme(data.theme)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, applyTheme: setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}
