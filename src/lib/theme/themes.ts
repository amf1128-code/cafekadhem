import { createContext, useContext } from 'react'

export type ThemeId = 'theme1' | 'theme2' | 'theme3'

export interface ThemeMeta {
  id: ThemeId
  name: string
  tagline: string
}

export const THEMES: ThemeMeta[] = [
  { id: 'theme1', name: 'Archival', tagline: 'Editorial · Forest · Cream' },
  { id: 'theme2', name: 'Poster', tagline: 'Striped · Ultramarine · Bold' },
  { id: 'theme3', name: 'Watch Party', tagline: 'Gradient · Glow · Floating shapes' },
]

export const DEFAULT_THEME: ThemeId = 'theme1'

export interface ThemeContextValue {
  theme: ThemeId
  /**
   * Apply a theme locally (updates the document attribute and provider state).
   * Does NOT persist to the database — admin Settings save handles persistence.
   * Used by the admin Settings page for live preview while editing.
   */
  applyTheme: (theme: ThemeId) => void
  themes: ThemeMeta[]
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
