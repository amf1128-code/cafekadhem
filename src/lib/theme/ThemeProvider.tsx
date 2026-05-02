import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../supabase'
import { ThemeContext, THEMES, DEFAULT_THEME, type ThemeId } from './themes'

function isValidTheme(value: unknown): value is ThemeId {
  return value === 'theme1' || value === 'theme2' || value === 'theme3'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

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
