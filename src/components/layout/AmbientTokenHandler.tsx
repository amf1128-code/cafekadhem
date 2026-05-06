import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { setGuestToken } from '../../lib/utils/guest-token'

/**
 * Resolves ambient ?as=<token> on page load: looks up the guest_id,
 * caches it in localStorage, and strips the param from the URL so it
 * doesn't persist in the address bar / browser history.
 *
 * Mounted in PublicLayout so it runs on every public route. Idempotent
 * — re-running with the same param does nothing because the param is
 * stripped on first run.
 *
 * USER_FLOWS_SPEC.md §3a.1 (URL token = highest-precedence identity source).
 */
export function AmbientTokenHandler() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const token = params.get('as')
    if (!token) return

    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc('resolve_ambient_token', {
        p_token: token,
      })
      if (cancelled) return

      if (!error && data?.ok && data.guest_id) {
        setGuestToken(data.guest_id)
      }

      // Strip the param regardless of outcome (privacy: don't leave the
      // token visible in the browser back-stack or analytics referrers).
      params.delete('as')
      const search = params.toString()
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : '' },
        { replace: true },
      )
    })()

    return () => {
      cancelled = true
    }
  }, [location.search, location.pathname, navigate])

  return null
}
