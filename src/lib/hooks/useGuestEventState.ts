import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabase'

/**
 * useGuestEventState — wraps the get_guest_event_state RPC (migration
 * 029, hot-fix 035). Returns the canonical (guest, event) shape from
 * USER_FLOWS_SPEC.md §5, with a derived `next_step` value that drives
 * page render decisions.
 *
 * Status note: this hook is currently provided for future use and not
 * yet consumed by EventDetail / Order / Ticket / Pickup. Those pages
 * still infer state locally — they each get the right answer today,
 * just not from a single source. See IMPLEMENTATION_PLAN.md decision
 * log #4 for context. New state-aware pages should consume this hook
 * instead of replicating the logic.
 */

export type NextStep =
  | 'rsvp'
  | 'pay'
  | 'view_ticket'
  | 'view_order'
  | 'add_plus_one'
  | 'edit_rsvp'
  | 'closed'

export type GuestEventState = {
  rsvp: 'yes' | 'maybe' | 'no' | 'waitlisted' | null
  waitlist_position: number | null
  plus_one: { name: string } | null
  is_ticketed_event: boolean
  payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | null
  ticket_token: string | null
  checked_in_at: string | null
  has_food_order: boolean
  food_order_total: number | null
  capacity_remaining: number | null
  invited_by: string | null
  next_step: NextStep
}

export function useGuestEventState(
  eventId: string | null | undefined,
  guestId: string | null | undefined,
): {
  state: GuestEventState | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
} {
  const [state, setState] = useState<GuestEventState | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!eventId || !guestId) {
      setState(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('get_guest_event_state', {
      p_event_id: eventId,
      p_guest_id: guestId,
    })
    if (rpcError) {
      setError(rpcError.message)
      setState(null)
    } else if (data && typeof data === 'object' && 'error' in data) {
      setError(String((data as { error: string }).error))
      setState(null)
    } else {
      setState((data as GuestEventState) ?? null)
    }
    setLoading(false)
  }, [eventId, guestId])

  useEffect(() => {
    void fetch()
  }, [fetch])

  return { state, loading, error, refetch: fetch }
}
