import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { RecognitionHeader } from './RecognitionHeader'

export function Header() {
  const [pickupActive, setPickupActive] = useState(false)
  const { pathname } = useLocation()
  const isHome = pathname === '/'

  useEffect(() => {
    let cancelled = false
    supabase
      .from('pickup_config')
      .select('is_active')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPickupActive(!!data)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <header className="page-bg">
      <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        {/* Brand link only appears off the home page — on home the big
            hero lockup is the brand, so duplicating it here would clutter
            the chrome. */}
        {isHome ? (
          <span aria-hidden="true" />
        ) : (
          <Link
            to="/"
            className="text-xs tracking-[0.2em] uppercase text-ink-muted hover:text-forest transition-colors"
          >
            Cafe Kadhem
          </Link>
        )}
        <nav className="flex items-center gap-5">
          {pickupActive && (
            <Link
              to="/pickup"
              className="text-xs tracking-[0.2em] uppercase text-ink-muted hover:text-forest transition-colors"
            >
              Pick-Up
            </Link>
          )}
          <RecognitionHeader />
        </nav>
      </div>
    </header>
  )
}
