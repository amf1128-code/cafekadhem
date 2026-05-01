import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type ThemeId = 'theme1' | 'theme2'

export interface ThemeMeta {
  id: ThemeId
  name: string
  tagline: string
}

export const THEMES: ThemeMeta[] = [
  { id: 'theme1', name: 'Archival', tagline: 'Editorial · Forest · Cream' },
  { id: 'theme2', name: 'Poster', tagline: 'Striped · Ultramarine · Bold' },
]

const STORAGE_KEY = 'cafekadhem.theme'
const DEFAULT_THEME: ThemeId = 'theme1'

function readStoredTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'theme1' || stored === 'theme2' ? stored : DEFAULT_THEME
}

interface ThemeContextValue {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
  toggleTheme: () => void
  themes: ThemeMeta[]
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

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

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
