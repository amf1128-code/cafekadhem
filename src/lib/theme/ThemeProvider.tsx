import { useEffect, useState, type ReactNode } from 'react'
import { ThemeContext, THEMES, type ThemeId } from './themes'

const STORAGE_KEY = 'cafekadhem.theme'
const DEFAULT_THEME: ThemeId = 'theme1'

function readStoredTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'theme1' || stored === 'theme2' ? stored : DEFAULT_THEME
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const setTheme = (next: ThemeId) => setThemeState(next)
  const toggleTheme = () =>
    setThemeState(prev => (prev === 'theme1' ? 'theme2' : 'theme1'))

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}
