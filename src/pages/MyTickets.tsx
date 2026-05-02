import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getGuestToken, setGuestToken, clearGuestToken } from '../lib/utils/guest-token'
import { formatDate, formatTime } from '../lib/utils/date'
import { PageLoader } from '../components/ui/LoadingSpinner'

interface RsvpRow {
  rsvp_id: string
  status: 'yes' | 'maybe' | 'no' | 'waitlisted'
  payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded'
  ticket_token: string | null
  checked_in_at: string | null
  rsvp_created_at: string
  event_id: string
  event_title: string
  event_date: string
  event_start_time: string
  event_end_time: string | null
  event_location: string
  event_location_name: string | null
  event_flyer_url: string | null
  ticketing_enabled: boolean
  ticket_price: number | null
  is_published: boolean
}

interface PickupRow {
  id: string
  pickup_date: string
  pickup_time: string
  status: string
  total: number | null
  created_at: string
}

interface History {
  guest_id: string
  first_name: string
  last_name: string | null
  rsvps: RsvpRow[]
  pickups: PickupRow[]
}

type State =
  | { kind: 'loading' }
  | { kind: 'history'; history: History }
  | { kind: 'unknown' }
  | { kind: 'expired' }

export function MyTickets() {
  const [params, setParams] = useSearchParams()
  const tokenParam = params.get('t')
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function run() {
      // 1. If a magic-link token is in the URL, redeem it first.
      if (tokenParam) {
        const { data: redeemedGuestId, error } = await supabase.rpc('redeem_magic_link', {
          p_token: tokenParam,
        })
        // Strip the token from the URL whether or not it worked, so the page
        // can be bookmarked / shared without leaking the token.
        const next = new URLSearchParams(params)
        next.delete('t')
        setParams(next, { replace: true })

        if (error || !redeemedGuestId) {
          if (!cancelled) setState({ kind: 'expired' })
          return
        }
        setGuestToken(redeemedGuestId as string)
        await loadFor(redeemedGuestId as string, cancelled)
        return
      }

      // 2. Otherwise fall back to the persistent localStorage guest id.
      const existing = getGuestToken()
      if (!existing) {
        if (!cancelled) setState({ kind: 'unknown' })
        return
      }
      await loadFor(existing, cancelled)
    }

    async function loadFor(guestId: string, isCancelled: boolean) {
      const { data, error } = await supabase.rpc('get_guest_history', { p_guest_id: guestId })
      if (isCancelled) return
      if (error || !data) {
        // Stale/invalid local id — clear it so the user can re-lookup.
        clearGuestToken()
        setState({ kind: 'unknown' })
        return
      }
      setState({ kind: 'history', history: data as History })
    }

    run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenParam])

  if (state.kind === 'loading') return <PageLoader />

  if (state.kind === 'expired') {
    return (
      <Centered>
        <p className="font-serif text-xl text-ink-muted italic mb-3">Link expired.</p>
        <p className="text-sm text-ink-muted mb-6">
          Magic links are good for 24 hours. Request a fresh one to see your tickets.
        </p>
        <Link
          to="/find-tickets"
          className="inline-block border border-warm px-5 py-2 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors"
        >
          [ Find my tickets ]
        </Link>
      </Centered>
    )
  }

  if (state.kind === 'unknown') {
    return (
      <Centered>
        <p className="font-serif text-xl text-ink-muted italic mb-3">We don't recognize you yet.</p>
        <p className="text-sm text-ink-muted mb-6">
          Enter your email or phone and we'll send you a link to your RSVPs and tickets.
        </p>
        <Link
          to="/find-tickets"
          className="inline-block border border-warm px-5 py-2 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors"
        >
          [ Find my tickets ]
        </Link>
      </Centered>
    )
  }

  const { history } = state
  const upcoming = history.rsvps.filter(r => r.event_date >= today())
  const past = history.rsvps.filter(r => r.event_date < today())

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-8">
        <p className="text-xs tracking-[0.25em] uppercase text-ink-muted mb-2">Cafe Kadhem</p>
        <h1 className="font-serif text-3xl text-forest-dark italic">
          Hi {history.first_name}
        </h1>
        <p className="text-sm text-ink-muted mt-1">Your RSVPs and tickets</p>
      </div>

      <Section title="Upcoming">
        {upcoming.length === 0 ? (
          <Empty text="Nothing on your calendar yet." />
        ) : (
          upcoming.map(r => <RsvpCard key={r.rsvp_id} rsvp={r} />)
        )}
      </Section>

      {past.length > 0 && (
        <Section title="Past">
          {past.map(r => <RsvpCard key={r.rsvp_id} rsvp={r} past />)}
        </Section>
      )}

      {history.pickups.length > 0 && (
        <Section title="Pickup orders">
          {history.pickups.map(p => (
            <div key={p.id} className="border border-warm bg-parchment-light p-4 mb-3">
              <div className="flex justify-between items-baseline">
                <p className="font-serif text-lg text-ink">
                  {formatDate(p.pickup_date)} at {formatTime(p.pickup_time)}
                </p>
                <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted">{p.status}</p>
              </div>
              {p.total != null && (
                <p className="text-sm text-ink-muted mt-1">${p.total.toFixed(2)}</p>
              )}
            </div>
          ))}
        </Section>
      )}

      <div className="mt-12 pt-6 border-t border-warm text-center">
        <button
          onClick={() => {
            clearGuestToken()
            window.location.href = '/'
          }}
          className="text-xs tracking-[0.2em] uppercase text-ink-muted hover:text-ink transition-colors"
        >
          [ Sign out of this device ]
        </button>
      </div>
    </div>
  )
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-[10px] tracking-[0.25em] uppercase text-ink-muted mb-3">{title}</h2>
      {children}
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-ink-muted italic">{text}</p>
}

function RsvpCard({ rsvp, past }: { rsvp: RsvpRow; past?: boolean }) {
  const hasTicket = rsvp.payment_status === 'paid' && rsvp.ticket_token
  return (
    <div className={`border border-warm bg-parchment-light p-5 mb-3 ${past ? 'opacity-75' : ''}`}>
      <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
        <Link
          to={rsvp.is_published ? `/events/${rsvp.event_id}` : '#'}
          className="font-serif text-xl text-forest-dark italic hover:underline"
        >
          {rsvp.event_title}
        </Link>
        <StatusBadge rsvp={rsvp} />
      </div>
      <p className="text-sm text-ink-muted mb-3">
        {formatDate(rsvp.event_date)} · {formatTime(rsvp.event_start_time)}
        {rsvp.event_location_name ? ` · ${rsvp.event_location_name}` : ''}
      </p>
      <div className="flex gap-3 flex-wrap">
        {hasTicket && (
          <Link
            to={`/ticket/${rsvp.ticket_token}`}
            className="border border-forest px-4 py-2 text-xs tracking-[0.2em] uppercase text-forest hover:bg-forest hover:text-cream transition-colors"
          >
            [ View ticket ]
          </Link>
        )}
        {!past && rsvp.is_published && (
          <Link
            to={`/events/${rsvp.event_id}`}
            className="border border-warm px-4 py-2 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors"
          >
            [ Event details ]
          </Link>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ rsvp }: { rsvp: RsvpRow }) {
  const label =
    rsvp.checked_in_at ? 'Checked in' :
    rsvp.payment_status === 'paid' ? 'Paid' :
    rsvp.payment_status === 'pending' ? 'Payment pending' :
    rsvp.status === 'waitlisted' ? 'Waitlisted' :
    rsvp.status === 'yes' ? 'Going' :
    rsvp.status === 'maybe' ? 'Maybe' :
    rsvp.status === 'no' ? 'Not going' : ''
  return (
    <span className="text-[10px] tracking-[0.2em] uppercase text-ink-muted whitespace-nowrap">
      {label}
    </span>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-xl mx-auto px-6 py-16 text-center">
      {children}
    </div>
  )
}
