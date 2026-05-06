import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import type { Event } from '../../../lib/types'
import { isUpcoming } from '../../../lib/utils/date'
import { CinemaPageLoader } from '../primitives'

/**
 * /cinema/calendar — full event list. Two stacks:
 *  1. Upcoming: every published event with a future date, soonest first.
 *  2. Past: every published event with a past date, most recent first.
 *
 * Each row links to the cinema-styled event detail page.
 */
export function CinemaCalendar() {
  const [upcoming, setUpcoming] = useState<Event[]>([])
  const [past, setPast] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('events')
        .select('*')
        .eq('is_published', true)
        .order('date', { ascending: true })
      if (cancelled) return
      const all = (data ?? []) as Event[]
      setUpcoming(all.filter(e => isUpcoming(e.date)))
      setPast(all.filter(e => !isUpcoming(e.date)).reverse())
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <CinemaPageLoader />

  return (
    <>
      {/* HEADER */}
      <section className="ck-page" style={{ paddingBottom: 36 }}>
        <div className="ck-eyebrow">✦ Every pop-up, past and future</div>
        <div
          className="ck-section-head-row"
          style={{ marginTop: 6, alignItems: 'baseline' }}
        >
          <h1 className="ck-h1">THE CALENDAR.</h1>
          <span
            style={{
              fontFamily: 'var(--ck-arabic-display)',
              fontSize: 'clamp(48px, 6vw, 84px)',
              direction: 'rtl',
              color: 'var(--ck-cobalt)',
              lineHeight: 0.9,
            }}
          >
            التقويم
          </span>
        </div>
        <p
          className="ck-italic"
          style={{
            fontSize: 18,
            marginTop: 14,
            maxWidth: 580,
            lineHeight: 1.4,
          }}
        >
          The whole roster — what's coming up and what's already happened.
          Each one had its own poster, its own menu, and its own night.
        </p>
      </section>

      {/* UPCOMING */}
      <section className="ck-page ck-page--paper">
        <div className="ck-section-head" style={{ marginBottom: 18 }}>
          <div className="ck-eyebrow">Coming up</div>
          <div className="ck-section-head-row">
            <h2 className="ck-h2">UPCOMING.</h2>
            <span
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 'clamp(36px, 4vw, 56px)',
                direction: 'rtl',
                color: 'var(--ck-cobalt)',
                lineHeight: 0.9,
              }}
            >
              قادم
            </span>
          </div>
        </div>

        {upcoming.length === 0 ? (
          <div
            style={{
              border: '2px solid var(--ck-ink)',
              padding: 28,
              fontFamily: 'var(--ck-serif-edit)',
              fontStyle: 'italic',
              fontSize: 18,
              background: 'var(--ck-cream)',
            }}
          >
            Nothing on the books at the moment — check back soon.
          </div>
        ) : (
          <div style={{ border: '2px solid var(--ck-ink)' }}>
            {upcoming.map((e, i) => (
              <CalendarFullRow
                key={e.id}
                event={e}
                alt={i % 2 === 1}
                last={i === upcoming.length - 1}
              />
            ))}
          </div>
        )}
      </section>

      {/* PAST */}
      {past.length > 0 && (
        <section id="archive" className="ck-page" style={{ borderBottom: 'none' }}>
          <div className="ck-section-head" style={{ marginBottom: 18 }}>
            <div className="ck-eyebrow">The archive</div>
            <div className="ck-section-head-row">
              <h2 className="ck-h2">PAST GATHERINGS.</h2>
              <span
                style={{
                  fontFamily: 'var(--ck-arabic-display)',
                  fontSize: 'clamp(36px, 4vw, 56px)',
                  direction: 'rtl',
                  color: 'var(--ck-cobalt)',
                  lineHeight: 0.9,
                }}
              >
                الأرشيف
              </span>
            </div>
          </div>
          <div style={{ border: '2px solid var(--ck-ink)' }}>
            {past.map((e, i) => (
              <CalendarFullRow
                key={e.id}
                event={e}
                alt={i % 2 === 1}
                last={i === past.length - 1}
                muted
              />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function CalendarFullRow({
  event,
  alt,
  last,
  muted = false,
}: {
  event: Event
  alt: boolean
  last: boolean
  muted?: boolean
}) {
  const day = formatDay(event.date)
  const date = formatDate(event.date)
  const time = formatTime(event.start_time, event.end_time)
  const loc = [event.location_name, event.location].filter(Boolean).join(' · ')
  const price = Math.round(event.ticket_price ?? 0)

  return (
    <Link
      to={`/cinema/events/${event.id}`}
      className="ck-cal-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '110px 1fr 200px 90px',
        gap: 20,
        alignItems: 'center',
        padding: '20px 24px',
        background: alt ? 'var(--ck-paper)' : 'var(--ck-cream)',
        borderBottom: last ? 'none' : '2px solid var(--ck-ink)',
        textDecoration: 'none',
        color: 'var(--ck-ink)',
        opacity: muted ? 0.7 : 1,
      }}
    >
      <div className="ck-cal-date">
        <div
          className="ck-cal-date-num"
          style={{
            fontFamily: 'var(--ck-serif)',
            fontWeight: 900,
            fontSize: 30,
            lineHeight: 0.9,
          }}
        >
          {date}
        </div>
        <div
          className="ck-cal-date-day"
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            marginTop: 2,
            textTransform: 'uppercase',
          }}
        >
          {day}
        </div>
      </div>

      <div className="ck-cal-title">
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span
            className="ck-cal-title-text"
            style={{
              fontFamily: 'var(--ck-serif)',
              fontWeight: 800,
              fontSize: 26,
              lineHeight: 1,
            }}
          >
            {event.title}
          </span>
          {event.display_arabic && (
            <span
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 24,
                direction: 'rtl',
                color: 'var(--ck-cobalt)',
              }}
            >
              {event.display_arabic}
            </span>
          )}
        </div>
        {event.tagline && (
          <div
            className="ck-cal-tagline"
            style={{
              fontFamily: 'var(--ck-serif-edit)',
              fontStyle: 'italic',
              fontSize: 14,
              marginTop: 4,
              lineHeight: 1.4,
              opacity: 0.85,
            }}
          >
            {event.tagline}
          </div>
        )}
      </div>

      <div
        className="ck-cal-loc"
        style={{
          fontFamily: 'var(--ck-mono)',
          fontSize: 11,
          letterSpacing: '0.14em',
          lineHeight: 1.5,
          textTransform: 'uppercase',
        }}
      >
        {loc || 'TBA'}
        <br />
        <span className="ck-cal-loc-time" style={{ opacity: 0.65 }}>
          {time}
        </span>
      </div>

      <div
        className="ck-cal-price"
        style={{
          fontFamily: 'var(--ck-serif)',
          fontWeight: 800,
          fontSize: 22,
          textAlign: 'right',
        }}
      >
        {muted ? '—' : price === 0 ? 'FREE' : `$${price}`}
      </div>
    </Link>
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
