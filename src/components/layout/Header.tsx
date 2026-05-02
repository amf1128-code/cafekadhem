import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export function Header() {
  const [pickupActive, setPickupActive] = useState(false)

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
      <div className="max-w-3xl mx-auto px-6 py-6 flex items-center justify-between gap-4">
        <Link to="/" className="group">
          <span className="font-serif text-xl text-forest-dark">
            Cafe Kadhem
          </span>
        </Link>
        <div className="flex items-center gap-4">
          {pickupActive && (
            <Link to="/pickup" className="text-xs tracking-[0.15em] uppercase text-ink-muted hover:text-forest transition-colors">
              Pick-Up
            </Link>
          )}
          <span className="font-arabic text-2xl text-forest">
            &#1603;&#1575;&#1601;&#1610;&#1607; &#1603;&#1575;&#1592;&#1605;
          </span>
        </div>
      </div>
    </header>
  )
}
