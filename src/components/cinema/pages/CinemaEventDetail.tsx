import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import type { Event, MenuItem, PublicGuestProfile, RSVP } from '../../../lib/types'
import { CinemaPageLoader } from '../primitives'

/**
 * /cinema/events/:id — cinema-styled event detail.
 *
 * STUB: data fetch + minimal cinema-styled detail. The full RSVP form,
 * ticketing, share, invite, and menu rendering still live on the legacy
 * /events/:id page. This stub exists so /cinema/* routes compile and so
 * the operator can preview the cinema chrome around an event detail
 * page; deep flows are filled in next.
 */
export function CinemaEventDetail() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const invitedBy = (location.state as { invitedBy?: string } | null)?.invitedBy ?? null
  const [event, setEvent] = useState<Event | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])
  const [rsvps, setRsvps] = useState<(RSVP & { guest: PublicGuestProfile })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!id) return
      const { data: ev } = await supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .single()
      if (cancelled) return
      setEvent(ev as Event | null)

      if (ev?.menu_id) {
        const { data: menuItems } = await supabase
          .from('public_menu_items')
          .select('*')
          .eq('menu_id', ev.menu_id)
          .order('sort_order')
        if (!cancelled && menuItems) setItems(menuItems as MenuItem[])
      }
      const { data: rsvpRows } = await supabase
        .from('rsvps')
        .select('*, guest:public_guest_profiles!guest_id(*)')
        .eq('event_id', id)
        .in('status', ['yes', 'maybe', 'waitlisted'])
      if (!cancelled && rsvpRows) {
        setRsvps(rsvpRows as (RSVP & { guest: PublicGuestProfile })[])
      }

      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <CinemaPageLoader />
  if (!event) {
    return (
      <section className="ck-page" style={{ textAlign: 'center', borderBottom: 'none' }}>
        <div className="ck-narrow">
          <div className="ck-eyebrow">✦ Hmm</div>
          <h1 className="ck-h1" style={{ marginTop: 12 }}>
            EVENT NOT
            <br />
            <span className="ck-italic">found.</span>
          </h1>
          <Link
            to="/cinema/calendar"
            className="ck-btn ck-btn--primary"
            style={{ marginTop: 28 }}
          >
            See the calendar →
          </Link>
        </div>
      </section>
    )
  }

  const day = formatDay(event.date)
  const date = formatDate(event.date)
  const time = formatTime(event.start_time, event.end_time)
  const loc = [event.location_name, event.location].filter(Boolean).join(' · ')
  const price = Math.round(event.ticket_price ?? 0)
  const yesCount = rsvps.filter(r => r.status === 'yes').length

  return (
    <>
      <section className="ck-page">
        {invitedBy && (
          <div
            style={{
              border: '2px solid var(--ck-ink)',
              background: 'var(--ck-cobalt)',
              color: 'var(--ck-cream)',
              padding: '10px 16px',
              fontFamily: 'var(--ck-mono)',
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              marginBottom: 18,
            }}
          >
            ✦ {invitedBy} invited you to this one.
          </div>
        )}

        <div className="ck-eyebrow">
          ✦ Pop-up{event.gathering_number ? ` · No. ${event.gathering_number.replace(/^\s*(no\.?|number|num\.?|#)\s*/i, '')}` : ''} · {day} {date}
        </div>
        <div
          className="ck-section-head-row"
          style={{ marginTop: 8, alignItems: 'baseline' }}
        >
          <h1
            className="ck-h1"
            style={{ whiteSpace: 'pre-line', fontSize: 'clamp(48px, 6.5vw, 80px)' }}
          >
            {event.title.toUpperCase()}
          </h1>
          {event.display_arabic && (
            <span
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 'clamp(40px, 5vw, 60px)',
                direction: 'rtl',
                color: 'var(--ck-sun)',
                textShadow: '2px 2px 0 var(--ck-ink)',
                lineHeight: 1,
              }}
            >
              {event.display_arabic}
            </span>
          )}
        </div>
        {event.tagline && (
          <p
            className="ck-italic"
            style={{
              fontSize: 18,
              marginTop: 14,
              maxWidth: 620,
              lineHeight: 1.4,
              color: 'var(--ck-cobalt)',
            }}
          >
            {event.tagline}
          </p>
        )}

        {/* Hero card: poster + details */}
        <div
          className="ck-hero-grid"
          style={{
            marginTop: 28,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 0,
            border: '3px solid var(--ck-ink)',
          }}
        >
          <div
            style={{
              position: 'relative',
              background: 'var(--ck-cobalt)',
              borderRight: '3px solid var(--ck-ink)',
              aspectRatio: '4/3',
              overflow: 'hidden',
            }}
          >
            {event.flyer_url ? (
              <img
                src={event.flyer_url}
                alt={event.title}
                loading="lazy"
                decoding="async"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
            ) : null}
          </div>
          <div
            style={{
              padding: 28,
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              background: 'var(--ck-cream)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 14,
                paddingBottom: 14,
                borderBottom: '2px solid var(--ck-ink)',
              }}
            >
              <div>
                <div className="ck-label" style={{ marginBottom: 4 }}>
                  When
                </div>
                <div
                  style={{
                    fontFamily: 'var(--ck-serif)',
                    fontWeight: 800,
                    fontSize: 22,
                    lineHeight: 1,
                  }}
                >
                  {day} {date}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--ck-mono)',
                    fontSize: 11,
                    letterSpacing: '0.14em',
                    marginTop: 4,
                    textTransform: 'uppercase',
                    opacity: 0.75,
                  }}
                >
                  {time}
                </div>
              </div>
              <div>
                <div className="ck-label" style={{ marginBottom: 4 }}>
                  Where
                </div>
                <div
                  style={{
                    fontFamily: 'var(--ck-sans)',
                    fontWeight: 600,
                    fontSize: 14,
                    lineHeight: 1.4,
                  }}
                >
                  {loc || 'TBA'}
                </div>
              </div>
            </div>

            {event.description && (
              <p
                style={{
                  fontFamily: 'var(--ck-sans)',
                  fontSize: 14,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                }}
              >
                {event.description}
              </p>
            )}

            <div
              style={{
                marginTop: 'auto',
                paddingTop: 14,
                borderTop: '1px dashed var(--ck-ink)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--ck-serif)',
                  fontWeight: 800,
                  fontSize: 28,
                }}
              >
                {price === 0 ? 'FREE' : `$${price}`}
              </div>
              <Link
                to={`/events/${event.id}`}
                className="ck-btn ck-btn--primary"
              >
                {event.ticketing_enabled ? 'Get a ticket' : 'RSVP'} →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Menu */}
      {items.length > 0 && (
        <section id="menu" className="ck-page ck-page--paper">
          <div className="ck-eyebrow">On the menu</div>
          <div className="ck-section-head-row" style={{ marginTop: 6 }}>
            <h2 className="ck-h2">THE MENU.</h2>
            <span
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 'clamp(36px, 4vw, 56px)',
                direction: 'rtl',
                color: 'var(--ck-cobalt)',
                lineHeight: 0.9,
              }}
            >
              القائمة
            </span>
          </div>
          <div
            style={{
              marginTop: 24,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 0,
              border: '2px solid var(--ck-ink)',
            }}
          >
            {items.map((it, i) => (
              <div
                key={it.id}
                style={{
                  padding: 20,
                  borderRight: '2px solid var(--ck-ink)',
                  borderBottom: '2px solid var(--ck-ink)',
                  background: i % 2 === 0 ? 'var(--ck-cream)' : 'var(--ck-paper)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--ck-mono)',
                      fontSize: 9,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      opacity: 0.7,
                    }}
                  >
                    {String(i + 1).padStart(2, '0')} / {it.category || 'BAKE'}
                  </span>
                  {it.display_arabic && (
                    <span
                      style={{
                        fontFamily: 'var(--ck-arabic-display)',
                        fontSize: 24,
                        direction: 'rtl',
                        color: 'var(--ck-cobalt)',
                      }}
                    >
                      {it.display_arabic}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--ck-serif)',
                    fontWeight: 800,
                    fontSize: 24,
                    lineHeight: 1,
                    textTransform: 'uppercase',
                  }}
                >
                  {it.name}
                </div>
                {it.description && (
                  <div
                    style={{
                      fontFamily: 'var(--ck-sans)',
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    {it.description}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 'auto',
                    paddingTop: 8,
                    borderTop: '1px dashed var(--ck-ink)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    fontFamily: 'var(--ck-serif)',
                    fontWeight: 800,
                    fontSize: 20,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--ck-mono)',
                      fontSize: 10,
                      letterSpacing: '0.14em',
                      opacity: 0.55,
                    }}
                  >
                    —— · —— · ——
                  </span>
                  <span>{it.price ? `$${Math.round(it.price)}` : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* RSVP roster (lightweight). The full RSVP form still lives at
          /events/:id; the cinema 'RSVP' button above links there. */}
      {rsvps.length > 0 && (
        <section className="ck-page" style={{ borderBottom: 'none' }}>
          <div className="ck-eyebrow">Who&apos;s in</div>
          <div className="ck-section-head-row" style={{ marginTop: 6 }}>
            <h2 className="ck-h2">{yesCount} ON THE LIST.</h2>
            <span
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 'clamp(36px, 4vw, 56px)',
                direction: 'rtl',
                color: 'var(--ck-cobalt)',
                lineHeight: 0.9,
              }}
            >
              الحضور
            </span>
          </div>
          <div
            style={{
              marginTop: 18,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {rsvps.map(r => (
              <span
                key={r.id}
                style={{
                  padding: '6px 14px',
                  border: '2px solid var(--ck-ink)',
                  background:
                    r.status === 'yes'
                      ? 'var(--ck-cream)'
                      : r.status === 'waitlisted'
                        ? 'var(--ck-paper)'
                        : 'transparent',
                  fontFamily: 'var(--ck-sans)',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {r.guest?.first_name ?? 'Guest'}
                {r.status === 'maybe' && (
                  <span style={{ opacity: 0.55, marginLeft: 6 }}>· maybe</span>
                )}
                {r.status === 'waitlisted' && (
                  <span style={{ opacity: 0.55, marginLeft: 6 }}>· waitlist</span>
                )}
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return m && d ? `${m}.${d}` : dateStr
}
function formatDay(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return date
    .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })
    .toUpperCase()
}
function formatTime(start: string, end: string | null): string {
  const startHour = Number(start.split(':')[0])
  const period = startHour >= 12 ? 'PM' : 'AM'
  const display = startHour % 12 || 12
  if (!end) return `${display}${period} TILL LATE`
  const endHour = Number(end.split(':')[0])
  const endPeriod = endHour >= 12 ? 'PM' : 'AM'
  const endDisplay = endHour % 12 || 12
  return `${display}${period} – ${endDisplay}${endPeriod}`
}
