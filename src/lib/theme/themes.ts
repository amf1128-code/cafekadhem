import { createContext, useContext, useEffect } from 'react'

export type ThemeId = 'theme1' | 'theme2' | 'theme3'

/**
 * The admin's site-wide theme setting. `'default'` means the home page
 * follows the next upcoming event's theme; the other values force the
 * home page into that theme regardless of upcoming events. Event detail
 * pages always use their own event's theme — unaffected by this setting.
 */
export type SiteThemeChoice = ThemeId | 'default'

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
  /** Currently active theme applied by PublicLayout. Pages set this via usePageTheme. */
  activeTheme: ThemeId
  /** Admin's site-wide setting (controls home page resolution). */
  siteTheme: SiteThemeChoice
  /** Imperatively swap the active theme. Used by usePageTheme and admin settings preview. */
  setActiveTheme: (theme: ThemeId) => void
  themes: ThemeMeta[]
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

/**
 * Page-driven theme: each public page declares the theme it should render in
 * (typically derived from the event it just loaded). PublicLayout subscribes
 * via context and swaps `data-theme` on the layout root. Pass `undefined`
 * while the page is still resolving its theme — the previously-active value
 * stays in place until you have a real answer, which (combined with the
 * localStorage cache in ThemeProvider) eliminates the theme1→themeX flash.
 */
export function usePageTheme(theme: ThemeId | undefined) {
  const { setActiveTheme } = useTheme()
  useEffect(() => {
    if (theme) setActiveTheme(theme)
  }, [theme, setActiveTheme])
}
