import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Event, MenuItem } from '../../lib/types'
import { isUpcoming } from '../../lib/utils/date'
import { Marquee } from './primitives'

interface CinemaEvent {
  id: string
  no: string
  title: string
  short: string
  day: string
  date: string
  time: string
  loc: string
  price: number
  ar: string
  tagline: string
  bullets: string[]
  posterUrl: string | null
  menu: CinemaMenuItem[]
}

interface CinemaMenuItem {
  name: string
  desc: string
  price: number
  cat: string
  ar: string
}

// Phrases scrolling between hero and the menu section. Strictly
// alternates EN ↔ AR. Arabic glosses:
//   كافيه كاظم — Cafe Kadhem
//   صحتين      — sahteen ("to your health")
//   تفضل       — tfadal ("please come in / help yourself")
//   بالعافية    — bel3afia ("enjoy your meal")
const HERO_MARQUEE_EN = [
  'EVERYTHING FROM SCRATCH',
  "BETTER THAN YOUR GRANDMA'S",
  'PISTACHIO BUNS HOT AT 9AM',
  'COME HUNGRY',
]
const HERO_MARQUEE_AR = ['كافيه كاظم', 'صحتين', 'تفضل', 'بالعافية']
const HERO_MARQUEE_ITEMS = interleaveAlternating(HERO_MARQUEE_EN, HERO_MARQUEE_AR)

/**
 * Zips two lists so the output strictly alternates between them.
 * If the lists are uneven the longer one's leftover entries get
 * appended at the end (acceptable for a marquee that loops).
 */
function interleaveAlternating<T>(a: T[], b: T[]): T[] {
  const out: T[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

// Designer-supplied fallback copy when the live event row is missing the
// optional cinema fields (Arabic display word, tagline, bullets). This
// keeps the layout's chrome populated until the schema is extended.
const FALLBACK_AR = ['الكأس', 'عيد ميلاد', 'طرب', 'سينما']

function padNo(n: string | number | null | undefined, fallback: string): string {
  if (n === null || n === undefined || n === '') return fallback
  // Admins sometimes type "No. 006" or "no 14" into the gathering_number
  // field. Strip leading "No." / "Number" / etc. so we don't end up with
  // "NO. No. 006" once the cinema landing prepends its own "NO." prefix.
  const cleaned = String(n)
    .replace(/^\s*(no\.?|number|num\.?|#)\s*/i, '')
    .trim()
  if (!cleaned) return fallback
  return cleaned.length >= 3 ? cleaned : cleaned.padStart(3, '0')
}

function formatCinemaDate(dateStr: string): string {
  // "2026-06-16" → "06.16.26"
  const [y, m, d] = dateStr.split('-')
  if (!y || !m || !d) return dateStr
  return `${m}.${d}.${y.slice(-2)}`
}

function formatCinemaDay(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return date
    .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })
    .toUpperCase()
}

function formatCinemaTime(start: string, end: string | null): string {
  const startHour = Number(start.split(':')[0])
  const period = startHour >= 12 ? 'PM' : 'AM'
  const display = startHour % 12 || 12
  if (!end) return `${display}${period} TILL LATE`
  const endHour = Number(end.split(':')[0])
  const endPeriod = endHour >= 12 ? 'PM' : 'AM'
  const endDisplay = endHour % 12 || 12
  return `${display}${period} – ${endDisplay}${endPeriod}`
}

function splitBullets(text: string | null): string[] {
  if (!text) return []
  // Accept either explicit newlines (one bullet per line) or a paragraph
  // of 2-3 sentences. Split on either, trim list markers if present.
  const byLine = text
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-•·*]\s*/, ''))
    .filter(Boolean)
  if (byLine.length > 1) return byLine.slice(0, 4)
  // Single-line text → split by sentence terminators.
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 4)
}

// Heuristic: titles longer than ~14 chars get split into two visual lines
// at the nearest space past the midpoint, matching the designer's
// "WORLD CUP / WATCH PARTY" treatment.
function makeDisplayTitle(title: string): string {
  const clean = title.toUpperCase().trim()
  if (clean.length <= 14 || clean.includes('\n')) return clean
  const mid = Math.floor(clean.length / 2)
  const after = clean.indexOf(' ', mid)
  const before = clean.lastIndexOf(' ', mid)
  const breakAt =
    after === -1
      ? before
      : before === -1
        ? after
        : after - mid <= mid - before
          ? after
          : before
  if (breakAt <= 0) return clean
  return clean.slice(0, breakAt) + '\n' + clean.slice(breakAt + 1)
}

function mapEvent(e: Event, idx: number, items: MenuItem[]): CinemaEvent {
  const display = makeDisplayTitle(e.title)
  const taglineFallback = e.description?.split(/\r?\n/)[0]?.trim() ?? ''
  return {
    id: e.id,
    no: padNo(e.gathering_number, String(14 + idx).padStart(3, '0')),
    title: display,
    short: e.title,
    day: formatCinemaDay(e.date),
    date: formatCinemaDate(e.date),
    time: formatCinemaTime(e.start_time, e.end_time),
    loc: [e.location_name, e.location].filter(Boolean).join(' · ') || e.location || 'TBA',
    price: Math.round(e.ticket_price ?? 0),
    ar: e.display_arabic?.trim() || FALLBACK_AR[idx % FALLBACK_AR.length],
    tagline: e.tagline?.trim() || taglineFallback || 'Pop-up cafe series. Come hungry.',
    // Prefer the explicit highlights column; fall back to description if
    // the admin hasn't filled highlights in yet.
    bullets: splitBullets(e.highlights ?? e.description),
    posterUrl: e.home_flyer_url || e.flyer_url,
    menu: items.map(item => ({
      name: item.name,
      desc: item.description ?? '',
      price: Math.round(item.price ?? 0),
      cat: (item.category || 'BAKE').toUpperCase(),
      ar: item.display_arabic?.trim() ?? '',
    })),
  }
}

const DEFAULT_MENU_BLURB =
  'The menu rotates with the night. This one travels with the pop-up — small, snackable, easy to eat one-handed.'

export function CinemaLanding() {
  const [events, setEvents] = useState<CinemaEvent[]>([])
  const [menuBlurb, setMenuBlurb] = useState<string>(DEFAULT_MENU_BLURB)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [eventsResult, settingsResult] = await Promise.all([
        supabase
          .from('events')
          .select('*, menu:menus(id, name, items:menu_items(*))')
          .eq('is_published', true)
          .order('date', { ascending: true }),
        supabase
          .from('admin_settings')
          .select('current_menu_blurb')
          .limit(1)
          .maybeSingle(),
      ])

      if (cancelled) return
      const upcoming = (eventsResult.data ?? []).filter(e => isUpcoming(e.date))
      const mapped = upcoming.map((e, i) => {
        const items: MenuItem[] = e.menu?.items ?? []
        return mapEvent(e as Event, i, items)
      })
      setEvents(mapped)
      const blurb = settingsResult.data?.current_menu_blurb?.trim()
      if (blurb) setMenuBlurb(blurb)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const next = events[0]

  return (
    <>
      {/* HERO */}
      {next ? (
        <HeroSection event={next} />
      ) : loading ? (
        <HeroSkeleton />
      ) : (
        <HeroEmpty />
      )}

      <Marquee items={HERO_MARQUEE_ITEMS} />

      {/* CURRENT MENU — only render if the next event has menu items */}
      {next && next.menu.length > 0 && (
        <MenuSection event={next} blurb={menuBlurb} />
      )}

      {/* CALENDAR — small preview of the next 1-2 upcoming events
          AFTER the hero one. Full calendar is /cinema/calendar. */}
      <CalendarSection events={events.slice(1, 3)} loading={loading} />

      {/* STORY */}
      <StorySection />
    </>
  )
}

function HeroSection({ event }: { event: CinemaEvent }) {
  return (
    <section
      className="ck-hero ck-section"
      style={{ borderBottom: '2px solid var(--ck-ink)', padding: '28px 28px 32px' }}
    >
      <div
        className="ck-hero-strap"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 18,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: 11,
            letterSpacing: '0.18em',
            color: 'var(--ck-cobalt)',
            textTransform: 'uppercase',
          }}
        >
          ✦ NEXT POP-UP · NO. {event.no} · {event.day} {event.date}
        </div>
        <div
          className="ck-hide-mobile"
          style={{
            fontFamily: 'var(--ck-serif-edit)',
            fontStyle: 'italic',
            fontSize: 16,
            color: 'var(--ck-ink)',
          }}
        >
          We bake and then throw pop-ups.
        </div>
      </div>

      <div
        className="ck-hero-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.1fr 1fr',
          gap: 0,
          border: '3px solid var(--ck-ink)',
        }}
      >
        {/* LEFT — POSTER */}
        {/* Wrap is transparent so any space below the caption (when the
            right RSVP rail is taller than poster + caption) shows the
            page bg, not a stranded cobalt band. The 4:3 inner frame
            still has cobalt as its placeholder color. */}
        <div
          className="ck-poster-wrap"
          style={{
            position: 'relative',
            background: 'transparent',
            overflow: 'hidden',
            borderRight: '3px solid var(--ck-ink)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4/3',
              background: 'var(--ck-cobalt)',
            }}
          >
            {event.posterUrl ? (
              <img
                src={event.posterUrl}
                alt={event.short}
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

            {/* Tape label top-left (was "FOLIO") */}
            <div
              style={{
                position: 'absolute',
                top: 16,
                left: 16,
                fontFamily: 'var(--ck-mono)',
                fontSize: 10,
                letterSpacing: '0.18em',
                color: 'var(--ck-cream)',
                background: 'var(--ck-ink)',
                padding: '6px 10px',
                border: '2px solid var(--ck-cream)',
                textTransform: 'uppercase',
                zIndex: 2,
              }}
            >
              TAPE {event.no}
            </div>

            {/* Arabic word top-right */}
            {event.ar && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 16,
                  fontFamily: 'var(--ck-arabic-display)',
                  fontSize: 64,
                  direction: 'rtl',
                  lineHeight: 1,
                  color: 'var(--ck-sun)',
                  textShadow: '2px 2px 0 var(--ck-ink)',
                  zIndex: 2,
                }}
              >
                {event.ar}
              </div>
            )}

            {/* Price seal bottom-right */}
            <div
              style={{
                position: 'absolute',
                bottom: 16,
                right: 16,
                width: 88,
                height: 88,
                border: '2px solid var(--ck-cream)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                color: 'var(--ck-cream)',
                background: 'rgba(30,43,208,0.85)',
                transform: 'rotate(-8deg)',
                zIndex: 2,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--ck-mono)',
                  fontSize: 8,
                  letterSpacing: '0.14em',
                }}
              >
                NO. {event.no}
              </div>
              <div
                style={{
                  fontFamily: 'var(--ck-serif)',
                  fontWeight: 900,
                  fontSize: event.price > 0 ? 22 : 28,
                  lineHeight: 1,
                  marginTop: event.price > 0 ? 2 : 4,
                }}
              >
                {event.price > 0 ? `$${event.price}` : 'FREE'}
              </div>
              {event.price > 0 && (
                <div
                  style={{
                    fontFamily: 'var(--ck-mono)',
                    fontSize: 7,
                    letterSpacing: '0.16em',
                    marginTop: 2,
                  }}
                >
                  SEAT
                </div>
              )}
            </div>

            {/* Date stamp bottom-left */}
            <div
              style={{
                position: 'absolute',
                bottom: 16,
                left: 16,
                color: 'var(--ck-cream)',
                background: 'var(--ck-ink)',
                padding: '8px 12px',
                border: '2px solid var(--ck-cream)',
                zIndex: 2,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--ck-serif)',
                  fontWeight: 900,
                  fontSize: 28,
                  lineHeight: 0.9,
                }}
              >
                {event.day} {event.date.slice(0, 5)}
              </div>
              <div
                style={{
                  fontFamily: 'var(--ck-mono)',
                  fontSize: 9,
                  letterSpacing: '0.16em',
                  marginTop: 2,
                  textTransform: 'uppercase',
                }}
              >
                {event.time}
              </div>
            </div>
          </div>

          {/* Caption strip */}
          <div
            style={{
              background: 'var(--ck-ink)',
              color: 'var(--ck-cream)',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontFamily: 'var(--ck-mono)',
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
            }}
          >
            <span>POSTER · POP-UP NO. {event.no}</span>
            <span>{event.loc.toUpperCase()}</span>
          </div>
        </div>

        {/* RIGHT — TITLE + DETAILS + RSVP */}
        <div
          className="ck-rsvp-rail"
          style={{
            background: 'var(--ck-cream)',
            padding: '28px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: 'var(--ck-serif)',
                fontWeight: 900,
                fontSize: 'clamp(44px, 4.6vw, 72px)',
                lineHeight: 0.85,
                letterSpacing: '-0.01em',
                whiteSpace: 'pre-line',
                margin: 0,
              }}
            >
              {event.title}
            </h1>
            <p
              style={{
                fontFamily: 'var(--ck-serif-edit)',
                fontStyle: 'italic',
                fontSize: 18,
                lineHeight: 1.35,
                marginTop: 12,
                color: 'var(--ck-cobalt)',
              }}
            >
              {event.tagline}
            </p>
          </div>

          {/* Details strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 14,
              padding: '14px 0',
              borderTop: '2px solid var(--ck-ink)',
              borderBottom: '2px solid var(--ck-ink)',
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: 'var(--ck-mono)',
                  fontSize: 9,
                  letterSpacing: '0.18em',
                  opacity: 0.65,
                  textTransform: 'uppercase',
                }}
              >
                When
              </div>
              <div
                style={{
                  fontFamily: 'var(--ck-serif)',
                  fontWeight: 800,
                  fontSize: 18,
                  marginTop: 3,
                }}
              >
                {event.day} {event.date.slice(0, 5)}
              </div>
              <div
                style={{
                  fontFamily: 'var(--ck-mono)',
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  opacity: 0.7,
                  textTransform: 'uppercase',
                }}
              >
                {event.time}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontFamily: 'var(--ck-mono)',
                  fontSize: 9,
                  letterSpacing: '0.18em',
                  opacity: 0.65,
                  textTransform: 'uppercase',
                }}
              >
                Where
              </div>
              <div
                style={{
                  fontFamily: 'var(--ck-sans)',
                  fontWeight: 600,
                  fontSize: 14,
                  marginTop: 3,
                  lineHeight: 1.3,
                }}
              >
                {event.loc}
              </div>
            </div>
          </div>

          {/* Bullets */}
          {event.bullets.length > 0 && (
            <ul
              style={{
                fontFamily: 'var(--ck-sans)',
                fontSize: 13.5,
                lineHeight: 1.55,
                paddingLeft: 18,
                margin: 0,
              }}
            >
              {event.bullets.map(b => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}

          <Link
            to={`/cinema/events/${event.id}`}
            style={{
              padding: '14px 22px',
              border: '2px solid var(--ck-ink)',
              background: 'var(--ck-cobalt)',
              color: 'var(--ck-cream)',
              fontFamily: 'var(--ck-sans)',
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <span>{event.price > 0 ? `Reserve · $${event.price}` : 'Save my seat'}</span>
            <span aria-hidden>→</span>
          </Link>

          <div
            style={{
              marginTop: 'auto',
              paddingTop: 14,
              borderTop: '1px dashed var(--ck-ink)',
              fontFamily: 'var(--ck-mono)',
              fontSize: 10,
              letterSpacing: '0.14em',
              color: 'var(--ck-ink)',
              opacity: 0.6,
              display: 'flex',
              justifyContent: 'space-between',
              textTransform: 'uppercase',
            }}
          >
            <span>CK-{event.no}</span>
            <span>RSVP / حجز</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function HeroSkeleton() {
  return (
    <section
      style={{
        padding: '60px 28px',
        borderBottom: '2px solid var(--ck-ink)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--ck-mono)',
          fontSize: 11,
          letterSpacing: '0.18em',
          opacity: 0.5,
          textTransform: 'uppercase',
        }}
      >
        Loading next pop-up…
      </div>
    </section>
  )
}

function HeroEmpty() {
  return (
    <section
      style={{
        padding: '70px 28px',
        borderBottom: '2px solid var(--ck-ink)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--ck-mono)',
          fontSize: 11,
          letterSpacing: '0.18em',
          color: 'var(--ck-cobalt)',
          textTransform: 'uppercase',
        }}
      >
        ✦ The Bakery is Resting
      </div>
      <h1
        style={{
          fontFamily: 'var(--ck-serif)',
          fontWeight: 900,
          fontSize: 'clamp(48px, 7vw, 88px)',
          lineHeight: 0.85,
          margin: '14px auto 18px',
          maxWidth: 720,
        }}
      >
        NO POP-UPS
        <br />
        ON THE BOOKS.
      </h1>
      <p
        style={{
          fontFamily: 'var(--ck-serif-edit)',
          fontStyle: 'italic',
          fontSize: 18,
          color: 'var(--ck-ink)',
          maxWidth: 540,
          margin: '0 auto',
        }}
      >
        New dates land soon. Follow along on Instagram or come back next week.
      </p>
    </section>
  )
}

function MenuSection({ event, blurb }: { event: CinemaEvent; blurb: string }) {
  return (
    <section
      id="menu"
      className="ck-section"
      style={{
        padding: '60px 28px',
        borderBottom: '2px solid var(--ck-ink)',
        background: 'var(--ck-paper)',
      }}
    >
      <div
        className="ck-menu-head"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--ck-mono)',
              fontSize: 11,
              letterSpacing: '0.18em',
              color: 'var(--ck-cobalt)',
              textTransform: 'uppercase',
            }}
          >
            ✦ POP-UP NO. {event.no} · {event.short.toUpperCase()}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 18,
              flexWrap: 'wrap',
              marginTop: 6,
            }}
          >
            <h2
              style={{
                fontFamily: 'var(--ck-serif)',
                fontWeight: 900,
                fontSize: 'clamp(56px, 7vw, 96px)',
                lineHeight: 0.85,
                margin: 0,
              }}
            >
              CURRENT MENU.
            </h2>
            <div
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 72,
                direction: 'rtl',
                color: 'var(--ck-cobalt)',
                lineHeight: 0.9,
              }}
            >
              القائمة
            </div>
          </div>
          <p
            style={{
              fontFamily: 'var(--ck-serif-edit)',
              fontStyle: 'italic',
              fontSize: 17,
              color: 'var(--ck-ink)',
              maxWidth: 540,
              marginTop: 10,
              lineHeight: 1.4,
            }}
          >
            {blurb}
          </p>
        </div>
        <div
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: 10,
            letterSpacing: '0.16em',
            color: 'var(--ck-ink)',
            textAlign: 'right',
            textTransform: 'uppercase',
            lineHeight: 1.6,
          }}
        >
          SERVED {event.day} {event.date}
          <br />
          {event.loc.toUpperCase()}
        </div>
      </div>

      <div
        className="ck-bakes-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 0,
          border: '2px solid var(--ck-ink)',
        }}
      >
        {event.menu.map((d, i) => (
          <div
            key={`${d.name}-${i}`}
            className="ck-bake-cell"
            style={{
              padding: 22,
              borderRight: '2px solid var(--ck-ink)',
              borderBottom: '2px solid var(--ck-ink)',
              background: i % 2 === 0 ? 'var(--ck-cream)' : 'var(--ck-paper)',
              minHeight: 200,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
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
                  }}
                >
                  {String(i + 1).padStart(2, '0')} / {d.cat}
                </span>
                {d.ar && (
                  <span
                    style={{
                      fontFamily: 'var(--ck-arabic-display)',
                      fontSize: 26,
                      direction: 'rtl',
                      color: 'var(--ck-cobalt)',
                    }}
                  >
                    {d.ar}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontFamily: 'var(--ck-serif)',
                  fontWeight: 800,
                  fontSize: 26,
                  lineHeight: 0.95,
                  marginTop: 6,
                  textTransform: 'uppercase',
                }}
              >
                {d.name}
              </div>
              {d.desc && (
                <div
                  style={{
                    fontFamily: 'var(--ck-sans)',
                    fontSize: 13,
                    marginTop: 8,
                    lineHeight: 1.5,
                  }}
                >
                  {d.desc}
                </div>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginTop: 16,
                borderTop: '1px dashed var(--ck-ink)',
                paddingTop: 8,
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
              <span
                style={{
                  fontFamily: 'var(--ck-serif)',
                  fontWeight: 800,
                  fontSize: 22,
                }}
              >
                {d.price > 0 ? `$${d.price}` : '—'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function CalendarSection({
  events,
  loading,
}: {
  events: CinemaEvent[]
  loading: boolean
}) {
  // The cinema landing only previews the next 1-2 events that come AFTER
  // the hero. The full event list (with the "Past Gatherings" archive)
  // lives at /calendar.
  return (
    <section
      id="calendar"
      className="ck-section"
      style={{ padding: '60px 28px', borderBottom: '2px solid var(--ck-ink)' }}
    >
      <div
        className="ck-cal-head"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 22,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--ck-mono)',
              fontSize: 11,
              letterSpacing: '0.18em',
              color: 'var(--ck-cobalt)',
              textTransform: 'uppercase',
            }}
          >
            What's coming up
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 18,
              flexWrap: 'wrap',
              marginTop: 6,
            }}
          >
            <h2
              style={{
                fontFamily: 'var(--ck-serif)',
                fontSize: 'clamp(48px, 6vw, 80px)',
                lineHeight: 0.85,
                fontWeight: 900,
                margin: 0,
              }}
            >
              ON THE BOOKS.
            </h2>
            <div
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 60,
                direction: 'rtl',
                color: 'var(--ck-cobalt)',
                lineHeight: 0.9,
              }}
            >
              التقويم
            </div>
          </div>
        </div>
        <Link
          to="/cinema/calendar"
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--ck-ink)',
            textDecoration: 'underline',
            textUnderlineOffset: 4,
          }}
        >
          See full calendar →
        </Link>
      </div>

      <div style={{ border: '2px solid var(--ck-ink)' }}>
        {loading ? (
          <div
            style={{
              padding: 24,
              fontFamily: 'var(--ck-mono)',
              fontSize: 11,
              letterSpacing: '0.18em',
              opacity: 0.5,
              textTransform: 'uppercase',
            }}
          >
            Loading…
          </div>
        ) : events.length === 0 ? (
          <div
            style={{
              padding: 24,
              fontFamily: 'var(--ck-serif-edit)',
              fontStyle: 'italic',
              fontSize: 17,
            }}
          >
            That's all on the calendar for now — check back soon.
          </div>
        ) : (
          events.map((e, i) => (
            <CalendarRow
              key={e.id}
              event={e}
              alt={i % 2 === 1}
              last={i === events.length - 1}
            />
          ))
        )}
      </div>
    </section>
  )
}

function CalendarRow({
  event,
  alt,
  last,
}: {
  event: CinemaEvent
  alt: boolean
  last: boolean
}) {
  // Slim two-column row: title (with optional Arabic) + date/time stack.
  // Whole row is a Link to the event detail page.
  return (
    <Link
      to={`/cinema/events/${event.id}`}
      className="ck-cal-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 16,
        alignItems: 'center',
        padding: '18px 22px',
        background: alt ? 'var(--ck-paper)' : 'var(--ck-cream)',
        borderBottom: last ? 'none' : '2px solid var(--ck-ink)',
        textDecoration: 'none',
        color: 'var(--ck-ink)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--ck-serif)',
            fontWeight: 800,
            fontSize: 24,
            lineHeight: 1,
          }}
        >
          {event.short}
        </span>
        {event.ar && (
          <span
            style={{
              fontFamily: 'var(--ck-arabic-display)',
              fontSize: 22,
              direction: 'rtl',
              color: 'var(--ck-cobalt)',
            }}
          >
            {event.ar}
          </span>
        )}
      </div>

      <div
        style={{
          textAlign: 'right',
          fontFamily: 'var(--ck-mono)',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          lineHeight: 1.5,
        }}
      >
        {event.day} {event.date.slice(0, 5)}
        <br />
        <span style={{ opacity: 0.65 }}>{event.time}</span>
      </div>
    </Link>
  )
}

function StorySection() {
  // Photo is uploaded to /public/story/portrait.jpg via GitHub
  // (see public/story/README.md). The <img> hides itself if the file
  // 404s and the dark "Drop a photo" placeholder underneath shows
  // through.
  const [photoMissing, setPhotoMissing] = useState(false)
  return (
    <section
      id="story"
      className="ck-section"
      style={{
        padding: '70px 28px',
        borderBottom: '2px solid var(--ck-ink)',
        background: 'var(--ck-cobalt)',
        color: 'var(--ck-cream)',
        position: 'relative',
      }}
    >
      <div
        className="ck-story-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: 40,
          alignItems: 'center',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--ck-mono)',
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
            }}
          >
            How this happened
          </div>
          <h2
            style={{
              fontFamily: 'var(--ck-serif)',
              fontWeight: 900,
              fontSize: 'clamp(56px, 7vw, 88px)',
              lineHeight: 0.82,
              margin: '8px 0 14px',
            }}
          >
            FOR KADHEM
            <br />
            AL-SAHER, &
            <br />
            <span style={{ fontStyle: 'italic', fontFamily: 'var(--ck-serif-edit)' }}>
              for the table
            </span>
          </h2>
          <div
            style={{
              fontFamily: 'var(--ck-arabic-display)',
              direction: 'rtl',
              fontSize: 'clamp(36px, 4vw, 56px)',
              color: 'var(--ck-sun)',
              textShadow: '2px 2px 0 var(--ck-ink)',
              lineHeight: 1,
              marginBottom: 22,
            }}
            aria-label="Kadhem Al-Saher in Arabic"
          >
            كاظم الساهر
          </div>
          <div
            className="ck-story-cols"
            style={{
              columnCount: 2,
              columnGap: 32,
              fontFamily: 'var(--ck-sans)',
              fontSize: 15,
              lineHeight: 1.7,
            }}
          >
            <p style={{ marginTop: 0 }}>
              Cafe Kadhem is named for Kadhem Al-Saher, the Iraqi singer
              whose voice plays in every taxi in Baghdad and was the
              soundtrack to my childhood. The pop-ups are an excuse to put
              him on loud, share the sweets that I bake too many of, and
              bring community together for a great time.
            </p>
            <p>
              Each night is its own thing — a bakery, a watch party, a DJ
              set. But it's always too much food, good music, and a table
              everyone gets a seat at.
            </p>
            <p>
              Every dollar from these events goes to charity. So far we've
              raised for Gaza, Sudan, and the Asiyah Women's Center here
              in New York. Come hungry, bring a friend, tell them to bring
              their friends, and stay as long as you want.
            </p>
          </div>
        </div>
        <div
          style={{
            position: 'relative',
            aspectRatio: '3/4',
            border: '3px solid var(--ck-cream)',
            overflow: 'hidden',
            background: 'var(--ck-ink)',
            color: 'var(--ck-cream)',
          }}
        >
          {!photoMissing && (
            <img
              src="/story/portrait.jpg"
              alt="Cafe Kadhem"
              loading="lazy"
              decoding="async"
              onError={() => setPhotoMissing(true)}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          )}
          {photoMissing && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--ck-mono)',
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                textAlign: 'center',
                padding: 24,
              }}
            >
              Add /public/story/portrait.jpg in GitHub.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
