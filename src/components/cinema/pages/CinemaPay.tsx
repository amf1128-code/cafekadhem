import { useEffect, useState } from 'react'
import { useParams, Link, Navigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import type { Event, AdminSettings, RSVP } from '../../../lib/types'
import { getGuestToken, setGuestToken } from '../../../lib/utils/guest-token'
import { NewTicketedRsvp } from '../../events/NewTicketedRsvp'

// Focused pay page (/pay/:id) — the reminder-link target for new-flow
// ticketed events. Same flow component as the event page, but stripped of
// the flyer / menu / roster so the only thing on screen is "pay to lock
// in your spot." Non-new-flow events bounce to the full event page.
export function CinemaPay() {
  const { id } = useParams<{ id: string }>()
  const [event, setEvent] = useState<Event | null>(null)
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [myRsvp, setMyRsvp] = useState<RSVP | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!id) return
    // Recognize the guest from ?as= before looking up their RSVP, so a
    // cross-device reminder tap lands on their own pay state. (The global
    // AmbientTokenHandler also does this, but effect ordering isn't
    // guaranteed, so resolve inline here too.)
    const asToken = new URLSearchParams(window.location.search).get('as')
    if (asToken) {
      const { data } = await supabase.rpc('resolve_ambient_token', { p_token: asToken })
      if (data?.ok && data.guest_id) setGuestToken(data.guest_id)
    }

    const [{ data: ev }, { data: settingsRow }] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('admin_settings').select('*').limit(1).single(),
    ])
    setEvent((ev as Event) ?? null)
    setSettings((settingsRow as AdminSettings) ?? null)

    const token = getGuestToken()
    if (token) {
      const { data: mine } = await supabase
        .from('rsvps')
        .select('*')
        .eq('event_id', id)
        .eq('guest_id', token)
        .is('plus_one_of', null)
        .maybeSingle()
      setMyRsvp((mine as RSVP | null) ?? null)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const isPayable = !!event && event.ticketing_enabled && event.use_new_rsvp_flow

  if (loading) {
    return (
      <section className="ck-page" style={{ textAlign: 'center', borderBottom: 'none' }}>
        <div className="ck-narrow">
          <p className="ck-mono">Loading…</p>
        </div>
      </section>
    )
  }

  // Not a new-flow ticketed event — send them to the full event page.
  if (!isPayable || !event) return <Navigate to={`/events/${id}`} replace />

  return (
    <section className="ck-page" style={{ borderBottom: 'none' }}>
      <div className="ck-narrow">
        <div className="ck-eyebrow">✦ Get a ticket</div>
        <h1 className="ck-h1" style={{ marginTop: 12 }}>
          {event.title}
        </h1>
        <div
          className="ck-card"
          style={{ marginTop: 22, padding: 24, background: 'var(--ck-cream)' }}
        >
          <NewTicketedRsvp
            eventId={event.id}
            event={event}
            settings={settings}
            existingRsvp={myRsvp}
            onComplete={load}
          />
        </div>
        <div style={{ marginTop: 18 }}>
          <Link to={`/events/${id}`} className="ck-btn">
            ← Full event details
          </Link>
        </div>
      </div>
    </section>
  )
}
