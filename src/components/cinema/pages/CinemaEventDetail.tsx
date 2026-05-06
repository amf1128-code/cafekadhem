import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import type { Event, MenuItem, PublicGuestProfile, RSVP } from '../../../lib/types'
import { getGuestToken } from '../../../lib/utils/guest-token'
import { RSVPForm } from '../../events/RSVPForm'
import { CinemaPageLoader } from '../primitives'

type RsvpWithGuest = RSVP & { guest: PublicGuestProfile }

/**
 * /cinema/events/:id — cinema-styled event detail. Wraps the legacy
 * RSVPForm component (handles plus-ones, merge verification, ticketing
 * Venmo links — too dense to clone) inside a cinema-styled section.
 * Form internals are still legacy Tailwind for now; cinema-tokenize
 * follow-up TODO.
 */
export function CinemaEventDetail() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const invitedBy = (location.state as { invitedBy?: string } | null)?.invitedBy ?? null
  const [event, setEvent] = useState<Event | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])
  const [rsvps, setRsvps] = useState<RsvpWithGuest[]>([])
  const [myRsvp, setMyRsvp] = useState<RSVP | null>(null)
  const [myPlusOne, setMyPlusOne] = useState<RsvpWithGuest | null>(null)
  const [loading, setLoading] = useState(true)
  const [listOpen, setListOpen] = useState(false)

  useEffect(() => {
    if (id) loadEvent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadEvent({ silent = false }: { silent?: boolean } = {}) {
    if (!id) return
    if (!silent) setLoading(true)

    const { data: ev } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single()
    setEvent(ev as Event | null)

    if (ev?.menu_id) {
      const { data: menuItems } = await supabase
        .from('public_menu_items')
        .select('*')
        .eq('menu_id', ev.menu_id)
        .order('sort_order')
      if (menuItems) setItems(menuItems as MenuItem[])
    }

    const { data: rsvpRows } = await supabase
      .from('rsvps')
      .select('*, guest:public_guest_profiles!guest_id(*)')
      .eq('event_id', id)
      .in('status', ['yes', 'maybe', 'waitlisted'])
    if (rsvpRows) setRsvps(rsvpRows as RsvpWithGuest[])

    const guestToken = getGuestToken()
    if (guestToken) {
      const { data: mine } = await supabase
        .from('rsvps')
        .select('*')
        .eq('event_id', id)
        .eq('guest_id', guestToken)
        .is('plus_one_of', null)
        .maybeSingle()
      setMyRsvp((mine as RSVP | null) ?? null)

      // The host's plus-one row points back at the host's RSVP via plus_one_of.
      if (mine) {
        const { data: po } = await supabase
          .from('rsvps')
          .select('*, guest:public_guest_profiles!guest_id(*)')
          .eq('plus_one_of', (mine as RSVP).id)
          .maybeSingle()
        setMyPlusOne((po as RsvpWithGuest | null) ?? null)
      } else {
        setMyPlusOne(null)
      }
    } else {
      setMyRsvp(null)
      setMyPlusOne(null)
    }

    if (!silent) setLoading(false)
  }

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
  // Group RSVPs into hosts (plus_one_of === null) + their plus-ones, plus
  // separate maybe and waitlist buckets. The +1s collapse onto their host
  // row as a "+1" suffix instead of rendering as standalone names.
  const hosts = rsvps.filter(r => r.plus_one_of === null)
  const plusOnes = rsvps.filter(r => r.plus_one_of !== null)
  const plusOneCountByHost = new Map<string, number>()
  for (const po of plusOnes) {
    if (po.plus_one_of) {
      plusOneCountByHost.set(
        po.plus_one_of,
        (plusOneCountByHost.get(po.plus_one_of) ?? 0) + 1,
      )
    }
  }
  const goingHosts = hosts.filter(r => r.status === 'yes')
  const maybeHosts = hosts.filter(r => r.status === 'maybe')
  const waitlistHosts = hosts.filter(r => r.status === 'waitlisted')
  const goingSeatCount =
    goingHosts.length +
    goingHosts.reduce(
      (sum, h) => sum + (plusOneCountByHost.get(h.id) ?? 0),
      0,
    )

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
              <a
                href="#rsvp"
                className="ck-btn ck-btn--primary"
              >
                {event.ticketing_enabled ? 'Get a ticket' : 'RSVP'} →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* RSVP FORM — wraps the legacy form in a cinema-styled container.
          The form's internals still use the existing tailwind palette;
          cinema-tokenize follow-up. */}
      <section
        id="rsvp"
        className="ck-page"
        style={{ background: 'var(--ck-paper)' }}
      >
        <div className="ck-narrow">
          <div className="ck-eyebrow">
            ✦ {event.ticketing_enabled ? 'Get a ticket' : 'Save a spot'}
          </div>
          <div
            className="ck-section-head-row"
            style={{ marginTop: 6, alignItems: 'baseline' }}
          >
            <h2 className="ck-h2">RSVP.</h2>
            <span
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 'clamp(36px, 4vw, 56px)',
                direction: 'rtl',
                color: 'var(--ck-cobalt)',
                lineHeight: 0.9,
              }}
            >
              حجز
            </span>
          </div>
          <div
            className="ck-card"
            style={{ marginTop: 22, padding: 24, background: 'var(--ck-cream)' }}
          >
            <RSVPForm
              eventId={event.id}
              event={event}
              existingRsvp={myRsvp}
              existingPlusOne={myPlusOne}
              isFull={
                !!event.capacity &&
                rsvps.filter(r => r.status === 'yes').length >= event.capacity
              }
              onRsvpComplete={() => loadEvent({ silent: true })}
            />
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

      {/* RSVP roster — summary counts + "See full list" modal. The
          page itself only shows totals so it scales to events with
          hundreds of RSVPs. The modal opens a scrollable, sectioned
          list (Going / Maybe / Waitlist). Plus-ones collapse onto
          their host as a "+1" suffix. */}
      {hosts.length > 0 && (
        <section className="ck-page" style={{ borderBottom: 'none' }}>
          <div className="ck-eyebrow">Who&apos;s in</div>
          <div className="ck-section-head-row" style={{ marginTop: 6 }}>
            <h2 className="ck-h2">
              {goingSeatCount} ON THE LIST.
            </h2>
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
              marginTop: 14,
              display: 'flex',
              gap: 22,
              flexWrap: 'wrap',
              fontFamily: 'var(--ck-mono)',
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
            }}
          >
            <span>
              <span style={{ color: 'var(--ck-cobalt)' }}>{goingSeatCount}</span>{' '}
              going
            </span>
            {maybeHosts.length > 0 && (
              <span>
                <span style={{ color: 'var(--ck-cobalt)' }}>{maybeHosts.length}</span>{' '}
                maybe
              </span>
            )}
            {waitlistHosts.length > 0 && (
              <span>
                <span style={{ color: 'var(--ck-cobalt)' }}>{waitlistHosts.length}</span>{' '}
                waitlist
              </span>
            )}
          </div>
          <button
            type="button"
            className="ck-btn"
            onClick={() => setListOpen(true)}
            style={{ marginTop: 22 }}
          >
            See the list →
          </button>
        </section>
      )}

      {listOpen && (
        <RsvpListModal
          onClose={() => setListOpen(false)}
          goingHosts={goingHosts}
          maybeHosts={maybeHosts}
          waitlistHosts={waitlistHosts}
          plusOneCountByHost={plusOneCountByHost}
        />
      )}
    </>
  )
}

/** Modal that lists every RSVP grouped by status. Plus-ones collapse
 *  onto their host with a +1 suffix. Scrollable for events with many
 *  RSVPs. */
function RsvpListModal({
  onClose,
  goingHosts,
  maybeHosts,
  waitlistHosts,
  plusOneCountByHost,
}: {
  onClose: () => void
  goingHosts: RsvpWithGuest[]
  maybeHosts: RsvpWithGuest[]
  waitlistHosts: RsvpWithGuest[]
  plusOneCountByHost: Map<string, number>
}) {
  // Lock body scroll while the modal is open + close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Who's coming"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(13, 13, 15, 0.7)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--ck-cream)',
          border: '3px solid var(--ck-ink)',
          width: 'min(560px, 100%)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '8px 8px 0 var(--ck-ink)',
        }}
      >
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '2px solid var(--ck-ink)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--ck-cream)',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--ck-mono)',
                fontSize: 10,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--ck-cobalt)',
              }}
            >
              ✦ Who&apos;s coming
            </div>
            <div
              style={{
                fontFamily: 'var(--ck-serif)',
                fontWeight: 900,
                fontSize: 26,
                lineHeight: 1,
                marginTop: 4,
              }}
            >
              The list.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 28,
              lineHeight: 1,
              cursor: 'pointer',
              color: 'var(--ck-ink)',
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            padding: 22,
            overflowY: 'auto',
            flex: 1,
            background: 'var(--ck-cream)',
          }}
        >
          <RsvpListGroup
            label="Going"
            ar="قادم"
            hosts={goingHosts}
            plusOneCountByHost={plusOneCountByHost}
            emptyText="Nobody yet — be the first."
          />
          {maybeHosts.length > 0 && (
            <RsvpListGroup
              label="Maybe"
              ar="ربما"
              hosts={maybeHosts}
              plusOneCountByHost={plusOneCountByHost}
              emptyText=""
            />
          )}
          {waitlistHosts.length > 0 && (
            <RsvpListGroup
              label="Waitlist"
              ar="قائمة الانتظار"
              hosts={waitlistHosts}
              plusOneCountByHost={plusOneCountByHost}
              emptyText=""
            />
          )}
        </div>
      </div>
    </div>
  )
}

function RsvpListGroup({
  label,
  ar,
  hosts,
  plusOneCountByHost,
  emptyText,
}: {
  label: string
  ar: string
  hosts: RsvpWithGuest[]
  plusOneCountByHost: Map<string, number>
  emptyText: string
}) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingBottom: 6,
          marginBottom: 10,
          borderBottom: '1px dashed var(--ck-ink)',
          fontFamily: 'var(--ck-mono)',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        <span>
          {label} ({hosts.length})
        </span>
        <span
          style={{
            fontFamily: 'var(--ck-arabic-display)',
            fontSize: 18,
            direction: 'rtl',
            color: 'var(--ck-cobalt)',
            letterSpacing: 0,
          }}
        >
          {ar}
        </span>
      </div>
      {hosts.length === 0 && emptyText ? (
        <p
          className="ck-italic"
          style={{ fontSize: 14, opacity: 0.7, margin: 0 }}
        >
          {emptyText}
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {hosts.map(h => {
            const plusOnes = plusOneCountByHost.get(h.id) ?? 0
            return (
              <li
                key={h.id}
                style={{
                  fontFamily: 'var(--ck-sans)',
                  fontSize: 15,
                  lineHeight: 1.35,
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {h.guest?.first_name ?? 'Guest'}
                </span>
                {plusOnes > 0 && (
                  <span
                    style={{
                      marginLeft: 8,
                      padding: '2px 8px',
                      border: '1px solid var(--ck-ink)',
                      background: 'var(--ck-paper)',
                      fontFamily: 'var(--ck-mono)',
                      fontSize: 10,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                    }}
                  >
                    +{plusOnes}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
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
