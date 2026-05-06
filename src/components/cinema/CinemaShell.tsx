import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { clearMyGuest, useMyGuest } from '../../lib/identity/useMyGuest'
import { KadhemLockup, Marquee, RegMark } from './primitives'

// Nav links — all rooted under /cinema/* so the preview is self-contained.
const NAV_LINKS = [
  { en: 'CALENDAR', ar: 'التقويم', href: '/cinema/calendar' },
  { en: 'MENU', ar: 'القائمة', href: '/cinema#menu' },
  { en: 'STORY', ar: 'القصة', href: '/cinema#story' },
  { en: 'TICKETS', ar: 'تذاكر', href: '/cinema/my-tickets' },
]

// Phrases scrolling at the bottom of every cinema page. Same set as
// the hero marquee — kept in sync intentionally so the chrome reads
// consistent. Strictly alternates EN ↔ AR.
const FOOTER_MARQUEE_EN = [
  'EVERYTHING FROM SCRATCH',
  "BETTER THAN YOUR GRANDMA'S",
  'PISTACHIO BUNS HOT AT 9AM',
  'COME HUNGRY',
]
const FOOTER_MARQUEE_AR = ['كافيه كاظم', 'صحتين', 'تفضل', 'بالعافية']
const FOOTER_MARQUEE: string[] = []
for (let i = 0; i < Math.max(FOOTER_MARQUEE_EN.length, FOOTER_MARQUEE_AR.length); i++) {
  if (i < FOOTER_MARQUEE_EN.length) FOOTER_MARQUEE.push(FOOTER_MARQUEE_EN[i])
  if (i < FOOTER_MARQUEE_AR.length) FOOTER_MARQUEE.push(FOOTER_MARQUEE_AR[i])
}

const CONTACT = {
  email: 'HI@CAFEKADHEM.COM',
  ig: '@CAFEKADHEM',
  igUrl: 'https://instagram.com/cafekadhem',
}

/**
 * The chrome that wraps every public page: top strip, nav, page body,
 * marquee, footer. Pages render their own sections inside the <Outlet />.
 *
 * Home (/) is a special case — its sections (hero / menu / calendar /
 * story) include their own section borders and are designed to read as
 * one continuous poster, so the shell still works there.
 */
export function CinemaShell() {
  const [navOpen, setNavOpen] = useState(false)
  const { pathname, hash } = useLocation()

  // Close mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false)
  }, [pathname, hash])

  const todayLine = useMemo(() => {
    const now = new Date()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const dow = now
      .toLocaleDateString('en-US', { weekday: 'short' })
      .toUpperCase()
    return `${m} / ${d} / ${dow} · صباح الخير`
  }, [])

  const isHome = pathname === '/cinema'

  return (
    <div className="cinema-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* TOP STRIP */}
      <div
        className="ck-strip"
        style={{
          borderBottom: '2px solid var(--ck-ink)',
          padding: '10px 28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--ck-cream)',
          fontFamily: 'var(--ck-mono)',
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
        }}
      >
        <span>✦ POP-UP CAFE SERIES · NEW YORK · EST. 2025</span>
        <span className="ck-hide-mobile">
          <CinemaRecognition fallback={todayLine} />
        </span>
      </div>

      {/* NAV */}
      <header
        className="ck-nav"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 28px',
          borderBottom: '2px solid var(--ck-ink)',
          gap: 16,
          background: 'var(--ck-cream)',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <Link
          to="/cinema"
          aria-label="Cafe Kadhem home"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            color: 'var(--ck-ink)',
            textDecoration: 'none',
          }}
        >
          <RegMark size={18} />
          <KadhemLockup size={0.6} />
        </Link>
        <nav
          className="ck-nav-links"
          style={{
            display: 'flex',
            gap: 26,
            fontFamily: 'var(--ck-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            alignItems: 'center',
          }}
        >
          {NAV_LINKS.map(l => (
            <NavLinkItem key={l.en} en={l.en} ar={l.ar} href={l.href} />
          ))}
        </nav>
        {isHome ? (
          <Link
            to="/cinema/calendar"
            className="ck-reserve"
            style={{
              padding: '12px 18px',
              border: '2px solid var(--ck-ink)',
              background: 'var(--ck-cobalt)',
              color: 'var(--ck-cream)',
              fontFamily: 'var(--ck-sans)',
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}
          >
            All Events →
          </Link>
        ) : (
          <Link
            to="/cinema"
            className="ck-reserve"
            style={{
              padding: '12px 18px',
              border: '2px solid var(--ck-ink)',
              background: 'var(--ck-cobalt)',
              color: 'var(--ck-cream)',
              fontFamily: 'var(--ck-sans)',
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}
          >
            Save a Spot →
          </Link>
        )}
        <button
          type="button"
          className="ck-burger"
          onClick={() => setNavOpen(o => !o)}
          aria-label="Menu"
          aria-expanded={navOpen}
          style={{
            display: 'none',
            width: 40,
            height: 40,
            border: '2px solid var(--ck-ink)',
            background: 'var(--ck-cream)',
            padding: 0,
            cursor: 'pointer',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <span style={{ width: 18, height: 2, background: 'var(--ck-ink)' }} />
          <span style={{ width: 18, height: 2, background: 'var(--ck-ink)' }} />
          <span style={{ width: 18, height: 2, background: 'var(--ck-ink)' }} />
        </button>
      </header>

      {navOpen && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            borderBottom: '2px solid var(--ck-ink)',
            background: 'var(--ck-cream)',
          }}
        >
          {NAV_LINKS.map(l => (
            <Link
              key={l.en}
              to={l.href}
              style={{
                padding: '16px 28px',
                fontFamily: 'var(--ck-mono)',
                fontSize: 12,
                letterSpacing: '0.16em',
                color: 'var(--ck-ink)',
                textDecoration: 'none',
                borderTop: '1px solid var(--ck-ink)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{l.en}</span>
              <span
                style={{
                  fontFamily: 'var(--ck-arabic-display)',
                  fontSize: 22,
                  direction: 'rtl',
                  letterSpacing: 0,
                }}
              >
                {l.ar}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* PAGE BODY */}
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>

      {/* MARQUEE — closes every page with a band of running text. */}
      <Marquee items={FOOTER_MARQUEE} />

      {/* FOOTER */}
      <footer
        className="ck-footer"
        style={{
          padding: '32px 28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 24,
          background: 'var(--ck-cream)',
          borderTop: '2px solid var(--ck-ink)',
        }}
      >
        <KadhemLockup size={0.7} />
        <div
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: 10,
            letterSpacing: '0.14em',
            lineHeight: 1.7,
            textTransform: 'uppercase',
          }}
        >
          <a
            href={`mailto:${CONTACT.email.toLowerCase()}`}
            style={{ color: 'var(--ck-ink)', textDecoration: 'none' }}
          >
            {CONTACT.email}
          </a>
          <br />
          <a
            href={CONTACT.igUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--ck-ink)', textDecoration: 'none' }}
          >
            {CONTACT.ig}
          </a>
        </div>
        <div
          style={{
            fontFamily: 'var(--ck-arabic-display)',
            fontSize: 36,
            direction: 'rtl',
            color: 'var(--ck-cobalt)',
          }}
        >
          صحتين
        </div>
      </footer>
    </div>
  )
}

function NavLinkItem({ en, ar, href }: { en: string; ar: string; href: string }) {
  // For in-page anchors (/#menu) we want the browser to navigate + scroll
  // — react-router NavLink handles that fine. We just want active styling
  // for routes (not for anchors).
  const isAnchor = href.includes('#')
  if (isAnchor) {
    return (
      <a
        href={href}
        style={{
          color: 'var(--ck-ink)',
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <span>{en}</span>
        <span style={{ opacity: 0.5 }}>/</span>
        <span
          style={{
            fontFamily: 'var(--ck-arabic-display)',
            fontSize: 18,
            direction: 'rtl',
            letterSpacing: 0,
          }}
        >
          {ar}
        </span>
      </a>
    )
  }
  return (
    <NavLink
      to={href}
      style={({ isActive }) => ({
        color: 'var(--ck-ink)',
        textDecoration: isActive ? 'underline' : 'none',
        textUnderlineOffset: 4,
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 8,
      })}
    >
      <span>{en}</span>
      <span style={{ opacity: 0.5 }}>/</span>
      <span
        style={{
          fontFamily: 'var(--ck-arabic-display)',
          fontSize: 18,
          direction: 'rtl',
          letterSpacing: 0,
        }}
      >
        {ar}
      </span>
    </NavLink>
  )
}

/**
 * Cinema-styled recognition strip. When the visitor's guest_id is in
 * localStorage, renders "HI, FIRST · NOT YOU?" — clicking "not you?"
 * prompts to forget the device. Anonymous visitors see a "I've been
 * here before →" link to /cinema/find-tickets.
 *
 * Falls back to the rotating date/greeting line while the guest row is
 * still loading so the strip doesn't flicker.
 */
function CinemaRecognition({ fallback }: { fallback: string }) {
  const { guest, loading } = useMyGuest()

  if (loading) return <span>{fallback}</span>

  if (!guest?.first_name) {
    return (
      <Link
        to="/cinema/find-tickets"
        style={{
          color: 'var(--ck-ink)',
          textDecoration: 'none',
          letterSpacing: '0.16em',
        }}
      >
        I&apos;ve been here before →
      </Link>
    )
  }

  return (
    <span style={{ letterSpacing: '0.16em' }}>
      <span style={{ opacity: 0.7 }}>HI, </span>
      <span style={{ color: 'var(--ck-cobalt)' }}>
        {guest.first_name.toUpperCase()}
      </span>
      <span style={{ opacity: 0.45, margin: '0 8px' }}>·</span>
      <button
        type="button"
        onClick={() => {
          if (
            confirm('Forget this device? You can sign back in from the next page.')
          ) {
            clearMyGuest()
          }
        }}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          font: 'inherit',
          letterSpacing: 'inherit',
          color: 'var(--ck-ink)',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
          cursor: 'pointer',
        }}
      >
        not you?
      </button>
    </span>
  )
}
