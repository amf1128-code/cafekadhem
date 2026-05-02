import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../supabase'
import {
  ThemeContext,
  THEMES,
  DEFAULT_THEME,
  type ThemeId,
  type SiteThemeChoice,
} from './themes'

const ACTIVE_THEME_CACHE_KEY = 'cafekadhem:active-theme'
const SITE_THEME_CACHE_KEY = 'cafekadhem:site-theme'

function isValidActiveTheme(value: unknown): value is ThemeId {
  return value === 'theme1' || value === 'theme2' || value === 'theme3'
}

function isValidSiteTheme(value: unknown): value is SiteThemeChoice {
  return (
    value === 'default' ||
    value === 'theme1' ||
    value === 'theme2' ||
    value === 'theme3'
  )
}

/**
 * Read the previously-applied theme from localStorage so the first paint
 * can use it instead of flashing the hard-coded default. Wrapped in
 * try/catch because Safari Private Mode and some embedded contexts
 * disallow localStorage entirely.
 */
function readCachedActiveTheme(): ThemeId {
  try {
    const v = localStorage.getItem(ACTIVE_THEME_CACHE_KEY)
    if (isValidActiveTheme(v)) return v
  } catch {
    // ignore
  }
  return DEFAULT_THEME
}

function readCachedSiteTheme(): SiteThemeChoice {
  try {
    const v = localStorage.getItem(SITE_THEME_CACHE_KEY)
    if (isValidSiteTheme(v)) return v
  } catch {
    // ignore
  }
  return 'default'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialised lazily from localStorage so the very first render already
  // matches whatever theme the user saw last time. This is the FOUC fix:
  // without it the page renders in DEFAULT_THEME for one tick before the
  // supabase fetch resolves and pages set their per-page theme.
  const [activeTheme, setActiveTheme] = useState<ThemeId>(readCachedActiveTheme)
  const [siteTheme, setSiteTheme] = useState<SiteThemeChoice>(readCachedSiteTheme)

  // Persist the active theme so the next visit avoids the flash. Persisting
  // on every change (rather than only at unload) is fine — it's a few bytes.
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_THEME_CACHE_KEY, activeTheme)
    } catch {
      // ignore
    }
  }, [activeTheme])

  useEffect(() => {
    try {
      localStorage.setItem(SITE_THEME_CACHE_KEY, siteTheme)
    } catch {
      // ignore
    }
  }, [siteTheme])

  // Fetch the admin-controlled site theme once on mount so we have an
  // authoritative value (the cache might be stale if the admin just changed it).
  useEffect(() => {
    let cancelled = false
    supabase
      .from('admin_settings')
      .select('theme')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (cancelled) return
        if (data && isValidSiteTheme(data.theme)) setSiteTheme(data.theme)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ThemeContext.Provider
      value={{ activeTheme, siteTheme, setActiveTheme, themes: THEMES }}
    >
      {children}
    </ThemeContext.Provider>
  )
}
