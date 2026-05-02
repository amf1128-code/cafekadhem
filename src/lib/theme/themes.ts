import { createContext, useContext } from 'react'

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

export interface ThemeContextValue {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
  toggleTheme: () => void
  themes: ThemeMeta[]
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
