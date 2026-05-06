import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { Event } from '../../../lib/types'

const FALLBACK_EVENT: Event = {
  id: 'preview-sample',
  title: 'Cafe Kadhem Turns 1',
  description:
    'A loud, candle-lit birthday for our first year on Utica Ave. Live music from the back room, sticky mint tea, and a cake that will absolutely not survive the night. Bring people you like.',
  date: '2026-05-30',
  start_time: '13:00',
  end_time: '23:00',
  location: '167 Utica Ave, Brooklyn',
  location_name: 'Cafe Kadhem',
  flyer_url: null,
  home_flyer_url: null,
  menu_id: null,
  capacity: 80,
  donation_info: 'Pay-what-you-can at the door. No one turned away.',
  gathering_number: null,
  event_type: null,
  rsvp_required: true,
  is_published: true,
  is_rsvp_open: true,
  ticketing_enabled: true,
  ticket_price: 1500,
  theme: 'theme1',
  display_arabic: null,
  tagline: null,
  highlights: null,
  created_at: '2026-05-01T12:00:00Z',
  updated_at: '2026-05-01T12:00:00Z',
}

/**
 * Loads the most recent published event so previews show a real-looking page.
 * Falls back to a hardcoded event if Supabase has nothing or errors out — that
 * way the previews always render, even on a fresh dev database.
 */
export function useSampleEvent(): { event: Event; isFallback: boolean; loading: boolean } {
  const [event, setEvent] = useState<Event>(FALLBACK_EVENT)
  const [isFallback, setIsFallback] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('events')
        .select('*')
        .eq('is_published', true)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      if (data) {
        setEvent(data as Event)
        setIsFallback(false)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { event, isFallback, loading }
}

export { FALLBACK_EVENT }
