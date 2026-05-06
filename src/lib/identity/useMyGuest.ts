import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../supabase'
import {
  GUEST_TOKEN_EVENT,
  clearGuestToken,
  getGuestToken,
} from '../utils/guest-token'

export type MyGuest = {
  id: string
  first_name: string | null
  email: string | null
  phone: string | null
  notification_preference: 'sms' | 'email' | 'both' | 'none' | null
}

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(GUEST_TOKEN_EVENT, callback)
  // Cross-tab updates: localStorage change events fire in OTHER tabs.
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(GUEST_TOKEN_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

/**
 * useMyGuest reads localStorage.guest_id and fetches the guest row via
 * get_my_guest. Returns null when no token is cached. Re-runs whenever
 * setGuestToken / clearGuestToken fires GUEST_TOKEN_EVENT, or when
 * another tab updates localStorage.
 *
 * USER_FLOWS_SPEC.md §3a.
 */
export function useMyGuest(): { guest: MyGuest | null; loading: boolean; refetch: () => void } {
  const guestId = useSyncExternalStore(subscribe, getGuestToken, () => null)
  const [guest, setGuest] = useState<MyGuest | null>(null)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!guestId) {
      setGuest(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data } = await supabase.rpc('get_my_guest', { p_guest_id: guestId })
      if (cancelled) return
      setGuest((data as MyGuest | null) ?? null)
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [guestId, version])

  return {
    guest,
    loading,
    refetch: () => setVersion((v) => v + 1),
  }
}

/**
 * Forget this device. USER_FLOWS_SPEC.md §3a.4.
 */
export function clearMyGuest() {
  clearGuestToken()
}
