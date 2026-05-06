import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import {
  clearGuestToken,
  getGuestToken,
  setGuestToken,
} from '../../../lib/utils/guest-token'
import { CinemaPageLoader } from '../primitives'

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

/**
 * /cinema/my-tickets — cinema-styled rebuild of MyTickets.
 *
 * Same redeem-token-or-load-guest flow as the legacy page.
 */
export function CinemaMyTickets() {
  const [params, setParams] = useSearchParams()
  const tokenParam = params.get('t')
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function loadFor(guestId: string) {
      const { data, error } = await supabase.rpc('get_guest_history', {
        p_guest_id: guestId,
      })
      if (cancelled) return
      if (error || !data) {
        clearGuestToken()
        setState({ kind: 'unknown' })
        return
      }
      setState({ kind: 'history', history: data as History })
    }

    async function run() {
      if (tokenParam) {
        const { data: redeemedGuestId, error } = await supabase.rpc(
          'redeem_magic_link',
          { p_token: tokenParam },
        )
        const next = new URLSearchParams(params)
        next.delete('t')
        setParams(next, { replace: true })
        if (error || !redeemedGuestId) {
          if (!cancelled) setState({ kind: 'expired' })
          return
        }
        setGuestToken(redeemedGuestId as string)
        await loadFor(redeemedGuestId as string)
        return
      }
      const existing = getGuestToken()
      if (!existing) {
        if (!cancelled) setState({ kind: 'unknown' })
        return
      }
      await loadFor(existing)
    }

    run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenParam])

  if (state.kind === 'loading') return <CinemaPageLoader />

  if (state.kind === 'expired' || state.kind === 'unknown') {
    const heading = state.kind === 'expired' ? 'LINK\nEXPIRED.' : 'WHO ARE\nYOU AGAIN?'
    const sub =
      state.kind === 'expired'
        ? 'Magic links last 24 hours. Pull up a fresh one.'
        : 'Type the email or phone you used and we’ll send a one-tap link.'
    return (
      <section className="ck-page" style={{ textAlign: 'center', borderBottom: 'none' }}>
        <div className="ck-narrow">
          <div className="ck-eyebrow">✦ Sign in</div>
          <h1
            className="ck-h1"
            style={{ marginTop: 12, whiteSpace: 'pre-line' }}
          >
            {heading}
          </h1>
          <p
            className="ck-italic"
            style={{ fontSize: 18, marginTop: 18 }}
          >
            {sub}
          </p>
          <Link
            to="/cinema/find-tickets"
            className="ck-btn ck-btn--primary"
            style={{ marginTop: 28 }}
          >
            Find my tickets →
          </Link>
        </div>
      </section>
    )
  }

  const { history } = state
  const t = today()
  const upcoming = history.rsvps.filter(r => r.event_date >= t)
  const past = history.rsvps.filter(r => r.event_date < t)

  return (
    <>
      <section className="ck-page">
        <div className="ck-eyebrow">✦ Welcome back</div>
        <div
          className="ck-section-head-row"
          style={{ marginTop: 8, alignItems: 'baseline' }}
        >
          <h1 className="ck-h1">HI, {history.first_name.toUpperCase()}.</h1>
          <span
            style={{
              fontFamily: 'var(--ck-arabic-display)',
              fontSize: 'clamp(48px, 6vw, 72px)',
              direction: 'rtl',
              color: 'var(--ck-cobalt)',
              lineHeight: 0.9,
            }}
          >
            أهلاً
          </span>
        </div>
        <p
          className="ck-italic"
          style={{ fontSize: 18, marginTop: 14, color: 'var(--ck-cobalt)' }}
        >
          Every RSVP, ticket, and pickup order tied to your account.
        </p>
      </section>

      <CinemaListSection
        title="UPCOMING."
        ar="قادم"
        eyebrow="On your calendar"
      >
        {upcoming.length === 0 ? (
          <EmptyMsg text="Nothing on your calendar yet." />
        ) : (
          upcoming.map(r => <RsvpCard key={r.rsvp_id} rsvp={r} />)
        )}
      </CinemaListSection>

      {past.length > 0 && (
        <CinemaListSection
          title="THE ARCHIVE."
          ar="الأرشيف"
          eyebrow="Past"
        >
          {past.map(r => (
            <RsvpCard key={r.rsvp_id} rsvp={r} past />
          ))}
        </CinemaListSection>
      )}

      {history.pickups.length > 0 && (
        <CinemaListSection
          title="PICKUP ORDERS."
          ar="استلام"
          eyebrow="Take-away"
        >
          {history.pickups.map(p => (
            <div
              key={p.id}
              className="ck-card"
              style={{
                marginBottom: 12,
                padding: 20,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--ck-serif)',
                    fontWeight: 800,
                    fontSize: 22,
                  }}
                >
                  {formatDate(p.pickup_date)} · {formatTime(p.pickup_time)}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--ck-mono)',
                    fontSize: 11,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    marginTop: 4,
                    opacity: 0.7,
                  }}
                >
                  {p.status}
                </div>
              </div>
              {p.total != null && (
                <div
                  style={{
                    fontFamily: 'var(--ck-serif)',
                    fontWeight: 800,
                    fontSize: 22,
                  }}
                >
                  ${p.total.toFixed(2)}
                </div>
              )}
            </div>
          ))}
        </CinemaListSection>
      )}

      <section className="ck-page" style={{ textAlign: 'center', borderBottom: 'none' }}>
        <button
          type="button"
          onClick={() => {
            clearGuestToken()
            window.location.href = '/cinema'
          }}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            font: 'inherit',
            fontFamily: 'var(--ck-mono)',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ck-ink)',
            opacity: 0.65,
            textDecoration: 'underline',
            textUnderlineOffset: 4,
            cursor: 'pointer',
          }}
        >
          Sign out of this device
        </button>
      </section>
    </>
  )
}

function CinemaListSection({
  title,
  ar,
  eyebrow,
  children,
}: {
  title: string
  ar: string
  eyebrow: string
  children: React.ReactNode
}) {
  return (
    <section className="ck-page">
      <div className="ck-section-head" style={{ marginBottom: 20 }}>
        <div className="ck-eyebrow">{eyebrow}</div>
        <div className="ck-section-head-row">
          <h2 className="ck-h2">{title}</h2>
          <span
            style={{
              fontFamily: 'var(--ck-arabic-display)',
              fontSize: 'clamp(36px, 4vw, 56px)',
              direction: 'rtl',
              color: 'var(--ck-cobalt)',
              lineHeight: 0.9,
            }}
          >
            {ar}
          </span>
        </div>
      </div>
      {children}
    </section>
  )
}

function RsvpCard({ rsvp, past = false }: { rsvp: RsvpRow; past?: boolean }) {
  const hasTicket = rsvp.payment_status === 'paid' && rsvp.ticket_token
  return (
    <div
      className="ck-card"
      style={{
        marginBottom: 12,
        opacity: past ? 0.75 : 1,
        padding: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <Link
          to={rsvp.is_published ? `/cinema/events/${rsvp.event_id}` : '#'}
          style={{
            fontFamily: 'var(--ck-serif)',
            fontWeight: 800,
            fontSize: 24,
            lineHeight: 1.1,
            color: 'var(--ck-ink)',
            textDecoration: 'none',
          }}
        >
          {rsvp.event_title}
        </Link>
        <StatusBadge rsvp={rsvp} />
      </div>
      <div
        style={{
          fontFamily: 'var(--ck-mono)',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          opacity: 0.75,
          marginBottom: 14,
        }}
      >
        {formatDate(rsvp.event_date)} · {formatTime(rsvp.event_start_time)}
        {rsvp.event_location_name ? ` · ${rsvp.event_location_name}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {hasTicket && (
          <Link
            to={`/cinema/ticket/${rsvp.ticket_token}`}
            className="ck-btn ck-btn--ink"
          >
            View ticket →
          </Link>
        )}
        {!past && rsvp.is_published && (
          <Link
            to={`/cinema/events/${rsvp.event_id}`}
            className="ck-btn"
          >
            Event details →
          </Link>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ rsvp }: { rsvp: RsvpRow }) {
  const label = rsvp.checked_in_at
    ? 'Checked in'
    : rsvp.payment_status === 'paid'
      ? 'Paid'
      : rsvp.payment_status === 'pending'
        ? 'Pending'
        : rsvp.status === 'waitlisted'
          ? 'Waitlisted'
          : rsvp.status === 'yes'
            ? 'Going'
            : rsvp.status === 'maybe'
              ? 'Maybe'
              : rsvp.status === 'no'
                ? 'Not going'
                : ''
  return (
    <span
      style={{
        fontFamily: 'var(--ck-mono)',
        fontSize: 10,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        padding: '4px 10px',
        border: '2px solid var(--ck-ink)',
        background: 'var(--ck-paper)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

function EmptyMsg({ text }: { text: string }) {
  return (
    <p
      className="ck-italic"
      style={{
        fontSize: 17,
        opacity: 0.7,
      }}
    >
      {text}
    </p>
  )
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return m && d ? `${m}.${d}` : dateStr
}
function formatTime(t: string | null | undefined): string {
  if (!t) return ''
  const [h] = t.split(':')
  const hour = Number(h)
  const period = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 || 12
  return `${display}${period}`
}
