import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import type {
  AdminSettings,
  CartItem,
  Event,
  MenuItem,
  MenuItemAvailability,
  PublicGuestProfile,
  RSVP,
} from '../../../lib/types'
import { getGuestToken, setGuestToken } from '../../../lib/utils/guest-token'
import {
  dispatchMergeVerification,
  type PendingMerge,
} from '../../../lib/identity/handlePendingMerge'
import { getPaymentProvider, openPaymentLink } from '../../../lib/payment'
import { buildVenmoNote } from '../../../lib/payment/venmo'
import { sendNotification } from '../../../lib/notifications'
import { instagramUrl } from '../../../lib/utils/instagram'
import { normalizePhone } from '../../../lib/utils/phone'
import { useToast } from '../../ui/Toast'
import { RSVPForm } from '../../events/RSVPForm'
import { CinemaPageLoader } from '../primitives'

type RsvpWithGuest = RSVP & { guest: PublicGuestProfile }

/**
 * /events/:id — cinema-styled event detail. Wraps the legacy
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
  // Pre-order cart. Lives at the page level so the menu grid + sticky
  // cart bar + checkout modal all share state. Guest info / Venmo /
  // safe_create_order plumbing happens inside CartCheckoutModal below.
  const [cart, setCart] = useState<CartItem[]>([])
  const [availability, setAvailability] = useState<
    Record<string, { max: number; sold: number }>
  >({})
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [cartOpen, setCartOpen] = useState(false)

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

    // Admin settings: powers the Venmo handle + sms toggle the cart
    // checkout needs.
    const { data: settingsRow } = await supabase
      .from('admin_settings')
      .select('*')
      .limit(1)
      .single()
    if (settingsRow) setSettings(settingsRow as AdminSettings)

    if (ev?.menu_id) {
      const [{ data: menuItems }, { data: avail }] = await Promise.all([
        supabase
          .from('public_menu_items')
          .select('*')
          .eq('menu_id', ev.menu_id)
          .order('sort_order'),
        supabase.rpc('event_menu_item_availability', { p_event_id: id }),
      ])
      if (menuItems) setItems(menuItems as MenuItem[])
      if (avail) {
        const map: Record<string, { max: number; sold: number }> = {}
        for (const row of avail as MenuItemAvailability[]) {
          map[row.menu_item_id] = { max: row.max_quantity, sold: row.sold_quantity }
        }
        setAvailability(map)
      }
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
            to="/calendar"
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
  // Coming-soon mode: published event with RSVP locked. We still show
  // poster + details, but swap the RSVP form (and pre-order menu) for
  // a "more details to come" panel + Jaya (جاية) tag.
  const rsvpOpen = event.is_rsvp_open ?? true
  // When false, the menu is shown read-only: no pre-order nudge, no
  // add-to-cart controls, no sticky cart / checkout.
  const preorderEnabled = event.preorder_enabled ?? true
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

  // Public ticket / seat availability shown in the hero card.
  //   - capacity null or 0 => unlimited, so no counter is shown.
  //   - seatsTaken mirrors the EXACT gate the RSVP form uses below
  //     (rsvps with status 'yes', plus-ones included), so "N left"
  //     reaches 0 at the same moment the CTA flips to "Join waitlist".
  const totalSeats = event.capacity || null
  const seatsTaken = rsvps.filter(r => r.status === 'yes').length
  const seatsRemaining =
    totalSeats !== null ? Math.max(0, totalSeats - seatsTaken) : null
  const seatNoun = event.ticketing_enabled ? 'ticket' : 'seat'

  // Cart total / count helpers + adjust handler. Caps a quantity to the
  // remaining stock when an event_menu_item_limit has been set.
  const cartTotal = cart.reduce(
    (sum, c) => sum + (c.menuItem.price ?? 0) * c.quantity,
    0,
  )
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0)
  function remainingFor(itemId: string): number | null {
    const a = availability[itemId]
    if (!a) return null
    return Math.max(a.max - a.sold, 0)
  }
  function adjustCart(item: MenuItem, delta: number) {
    setCart(prev => {
      const existing = prev.find(c => c.menuItem.id === item.id)
      if (existing) {
        const nextQty = existing.quantity + delta
        if (nextQty <= 0) {
          return prev.filter(c => c.menuItem.id !== item.id)
        }
        const remaining = remainingFor(item.id)
        if (delta > 0 && remaining !== null && nextQty > remaining) {
          return prev
        }
        return prev.map(c =>
          c.menuItem.id === item.id ? { ...c, quantity: nextQty } : c,
        )
      }
      if (delta > 0) {
        const remaining = remainingFor(item.id)
        if (remaining !== null && remaining < 1) return prev
        return [...prev, { menuItem: item, quantity: 1 }]
      }
      return prev
    })
  }

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

        <div
          className="ck-eyebrow"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span>
            ✦ Pop-up{event.gathering_number ? ` · No. ${event.gathering_number.replace(/^\s*(no\.?|number|num\.?|#)\s*/i, '')}` : ''} · {day} {date}
          </span>
          {!rsvpOpen && <DetailJayaTag />}
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
                {rsvpOpen ? (price === 0 ? 'FREE' : `$${price}`) : 'TBA'}
              </div>
              {rsvpOpen ? (
                <a href="#rsvp" className="ck-btn ck-btn--primary">
                  {event.ticketing_enabled ? 'Get a ticket' : 'RSVP'} →
                </a>
              ) : (
                <a href="#coming-soon" className="ck-btn">
                  More details to come →
                </a>
              )}
            </div>

            {/* Ticket / seat availability. Mirrors the capacity gate the
                RSVP form uses, so "N left" hits 0 exactly when the CTA
                flips to "Join waitlist". Hidden when capacity is unset
                (null/0 = unlimited) or while RSVP is locked (coming-soon). */}
            {rsvpOpen && totalSeats !== null && (
              <div
                className="ck-mono"
                style={{
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                }}
              >
                {seatsRemaining === 0 ? (
                  <span style={{ color: 'var(--ck-magenta)' }}>
                    {event.ticketing_enabled ? 'Sold out' : 'Full'} — join the
                    waitlist
                  </span>
                ) : (
                  <>
                    <span style={{ color: 'var(--ck-cobalt)' }}>
                      {seatsRemaining}
                    </span>{' '}
                    of {totalSeats} {seatNoun}s left
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* RSVP FORM / COMING-SOON — when is_rsvp_open is false the whole
          form (and its pre-order nudge) gets swapped for a single
          teaser panel with a Jaya tag. */}
      {!rsvpOpen ? (
        <section
          id="coming-soon"
          className="ck-page"
          style={{ background: 'var(--ck-paper)' }}
        >
          <div className="ck-narrow">
            <ComingSoonDetailPanel />
          </div>
        </section>
      ) : (
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
              isFull={totalSeats !== null && seatsTaken >= totalSeats}
              onRsvpComplete={() => loadEvent({ silent: true })}
            />
          </div>

          {/* Inline pre-order nudge — anchors down to the menu grid
              where each item is tap-to-add. Only shown if the event has
              a menu attached and pre-ordering is enabled. */}
          {preorderEnabled && items.length > 0 && (
            <a
              href="#menu"
              style={{
                marginTop: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '14px 18px',
                border: '2px solid var(--ck-ink)',
                background: 'var(--ck-cobalt)',
                color: 'var(--ck-cream)',
                fontFamily: 'var(--ck-sans)',
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                textDecoration: 'none',
                flexWrap: 'wrap',
              }}
            >
              <span>
                ✦ Pre-order food too?
                <span
                  style={{
                    fontFamily: 'var(--ck-serif-edit)',
                    fontStyle: 'italic',
                    fontWeight: 400,
                    fontSize: 13,
                    letterSpacing: 0,
                    textTransform: 'none',
                    marginLeft: 10,
                    opacity: 0.85,
                  }}
                >
                  beat the line at the door
                </span>
              </span>
              <span aria-hidden>↓</span>
            </a>
          )}
        </div>
      </section>
      )}

      {/* Menu — pre-orders are scoped to events with RSVP open. While
          coming-soon, taking payments would be premature, so we hide
          the menu cells + sticky cart + checkout modal entirely. */}
      {rsvpOpen && items.length > 0 && (
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
                <MenuCellControls
                  item={it}
                  preorderEnabled={preorderEnabled}
                  cartQty={cart.find(c => c.menuItem.id === it.id)?.quantity ?? 0}
                  remaining={remainingFor(it.id)}
                  unavailable={!it.is_available}
                  onAdd={() => adjustCart(it, 1)}
                  onRemove={() => adjustCart(it, -1)}
                />
              </div>
            ))}
          </div>
          <p
            style={{
              fontFamily: 'var(--ck-mono)',
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              marginTop: 14,
              opacity: 0.65,
            }}
          >
            {preorderEnabled
              ? 'Tap an item to add it to your cart. Pay one tab at the end.'
              : 'A taste of what we’re serving — available at the event.'}
          </p>
        </section>
      )}

      {/* RSVP roster — summary counts + "See full list" modal. The
          page itself only shows totals so it scales to events with
          hundreds of RSVPs. The modal opens a scrollable, sectioned
          list (Going / Maybe / Waitlist). Plus-ones collapse onto
          their host as a "+1" suffix. Hidden in coming-soon mode —
          there are no RSVPs to count yet. */}
      {rsvpOpen && hosts.length > 0 && (
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

      {preorderEnabled && cart.length > 0 && (
        <StickyCartBar
          count={cartCount}
          total={cartTotal}
          onCheckout={() => setCartOpen(true)}
        />
      )}

      {preorderEnabled && cartOpen && (
        <CartCheckoutModal
          cart={cart}
          event={event}
          settings={settings}
          existingRsvp={myRsvp}
          onClose={() => setCartOpen(false)}
          onAdjust={adjustCart}
          onClearCart={() => {
            setCart([])
            loadEvent({ silent: true })
          }}
        />
      )}
    </>
  )
}

/** Slapped-on "coming soon" sticker, modeled on the Cursor Sticker
 *  pattern in the design handoff: sun-yellow pill, ink border, hard
 *  2px shadow offset, rotated ~-10deg so it reads as a peeled-on
 *  label. جاية ("coming") + a small Latin "Coming soon" gloss. */
function DetailJayaTag() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        border: '2px solid var(--ck-ink)',
        background: 'var(--ck-sun)',
        color: 'var(--ck-ink)',
        borderRadius: 999,
        boxShadow: '2px 2px 0 var(--ck-ink)',
        transform: 'rotate(-10deg)',
        transformOrigin: 'center',
        whiteSpace: 'nowrap',
        lineHeight: 1,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--ck-arabic-display)',
          fontSize: 22,
          direction: 'rtl',
          letterSpacing: 0,
          lineHeight: 1,
        }}
      >
        جاية
      </span>
      <span
        style={{
          fontFamily: 'var(--ck-mono)',
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}
      >
        Coming soon
      </span>
    </span>
  )
}

/** Replaces the RSVP form on the event detail page when an event is
 *  published in coming-soon mode. */
function ComingSoonDetailPanel() {
  return (
    <>
      <div
        className="ck-section-head-row"
        style={{ alignItems: 'baseline' }}
      >
        <h2 className="ck-h2">SAVE THE DATE.</h2>
        <span
          style={{
            fontFamily: 'var(--ck-arabic-display)',
            fontSize: 'clamp(36px, 4vw, 56px)',
            direction: 'rtl',
            color: 'var(--ck-cobalt)',
            lineHeight: 0.9,
          }}
        >
          جاية
        </span>
      </div>
      <div
        className="ck-card"
        style={{
          marginTop: 22,
          padding: 28,
          background: 'var(--ck-cream)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--ck-mono)',
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ck-cobalt)',
            }}
          >
            ✦ More details to come
          </div>
          <DetailJayaTag />
        </div>
        <p
          className="ck-italic"
          style={{
            fontFamily: 'var(--ck-serif-edit)',
            fontStyle: 'italic',
            fontSize: 17,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          RSVPs aren&apos;t open for this one yet — we&apos;re still
          locking down the menu, the lineup, and a few other surprises.
          Hold the date; we&apos;ll flip the door open soon.
        </p>
        <p
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            margin: 0,
            opacity: 0.65,
          }}
        >
          Follow along on Instagram or check back next week.
        </p>
      </div>
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
            // CSS multi-column lays names out in two columns when the
            // container can fit two ~160px tracks side-by-side; on
            // narrower phones the browser drops to one column on its
            // own. columnCount caps the upper bound so wide screens
            // don't fan out into 3+ columns and look loose.
            columnWidth: '160px',
            columnCount: 2,
            columnGap: 24,
          }}
        >
          {hosts.map(h => {
            const plusOnes = plusOneCountByHost.get(h.id) ?? 0
            const handle = h.guest?.instagram ?? null
            return (
              <li
                key={h.id}
                style={{
                  fontFamily: 'var(--ck-sans)',
                  fontSize: 15,
                  lineHeight: 1.35,
                  // Keep a single row's name + IG + +N chip together
                  // when columns wrap.
                  breakInside: 'avoid',
                  marginBottom: 6,
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {h.guest?.first_name ?? 'Guest'}
                </span>
                {handle && (
                  <a
                    href={instagramUrl(handle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`@${handle} on Instagram`}
                    title={`@${handle}`}
                    style={{
                      marginLeft: 6,
                      display: 'inline-flex',
                      verticalAlign: 'middle',
                      color: 'var(--ck-cobalt)',
                      lineHeight: 0,
                    }}
                  >
                    <InstagramGlyph />
                  </a>
                )}
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

/**
 * Bottom strip on every menu cell. When the item isn't in the cart,
 * shows the price and an "Add" pill. When it's in the cart, swaps in
 * a − / qty / + stepper. Disables when sold out / unavailable.
 */
function MenuCellControls({
  item,
  preorderEnabled,
  cartQty,
  remaining,
  unavailable,
  onAdd,
  onRemove,
}: {
  item: MenuItem
  preorderEnabled: boolean
  cartQty: number
  remaining: number | null
  unavailable: boolean
  onAdd: () => void
  onRemove: () => void
}) {
  const soldOut =
    !!unavailable || (remaining !== null && remaining <= 0 && cartQty === 0)
  const atCap = remaining !== null && cartQty >= remaining
  const price = item.price ? `$${Math.round(item.price)}` : '—'

  return (
    <div
      style={{
        marginTop: 'auto',
        paddingTop: 8,
        borderTop: '1px dashed var(--ck-ink)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--ck-serif)',
          fontWeight: 800,
          fontSize: 22,
          lineHeight: 1,
        }}
      >
        {price}
      </span>

      {/* View-only menu: show price only, no add-to-cart controls. */}
      {!preorderEnabled ? null : soldOut ? (
        <span
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            padding: '4px 10px',
            border: '2px solid var(--ck-ink)',
            background: 'var(--ck-ink)',
            color: 'var(--ck-cream)',
          }}
        >
          Sold out
        </span>
      ) : cartQty === 0 ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={!item.price}
          aria-label={`Add ${item.name} to cart`}
          style={{
            padding: '8px 14px',
            border: '2px solid var(--ck-ink)',
            background: 'var(--ck-cobalt)',
            color: 'var(--ck-cream)',
            fontFamily: 'var(--ck-sans)',
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            cursor: item.price ? 'pointer' : 'not-allowed',
            opacity: item.price ? 1 : 0.45,
          }}
        >
          + Add
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove one ${item.name}`}
            style={cartStepBtnStyle}
          >
            −
          </button>
          <span
            style={{
              fontFamily: 'var(--ck-serif)',
              fontWeight: 800,
              fontSize: 18,
              minWidth: 22,
              textAlign: 'center',
            }}
          >
            {cartQty}
          </span>
          <button
            type="button"
            onClick={onAdd}
            disabled={atCap}
            aria-label={`Add another ${item.name}`}
            style={{
              ...cartStepBtnStyle,
              opacity: atCap ? 0.4 : 1,
              cursor: atCap ? 'not-allowed' : 'pointer',
            }}
          >
            +
          </button>
        </div>
      )}
    </div>
  )
}

const cartStepBtnStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  border: '2px solid var(--ck-ink)',
  background: 'var(--ck-cream)',
  color: 'var(--ck-ink)',
  fontFamily: 'var(--ck-serif)',
  fontWeight: 800,
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0,
}

/**
 * Sticky bar pinned to the bottom of the viewport whenever the cart
 * has items. Total + count + Checkout button.
 */
function StickyCartBar({
  count,
  total,
  onCheckout,
}: {
  count: number
  total: number
  onCheckout: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        background: 'var(--ck-ink)',
        color: 'var(--ck-cream)',
        borderTop: '2px solid var(--ck-ink)',
        boxShadow: '0 -6px 20px rgba(13, 13, 15, 0.25)',
        padding: '14px 22px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            opacity: 0.75,
          }}
        >
          ✦ Cart · {count} {count === 1 ? 'item' : 'items'}
        </span>
        <span
          style={{
            fontFamily: 'var(--ck-serif)',
            fontWeight: 900,
            fontSize: 24,
            lineHeight: 1,
          }}
        >
          ${total.toFixed(2)}
        </span>
      </div>
      <button
        type="button"
        onClick={onCheckout}
        style={{
          padding: '12px 18px',
          border: '2px solid var(--ck-cream)',
          background: 'var(--ck-cobalt)',
          color: 'var(--ck-cream)',
          fontFamily: 'var(--ck-sans)',
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        Checkout →
      </button>
    </div>
  )
}

/**
 * Cinema-styled cart checkout. Mirrors the legacy /events/:id/order
 * flow (upsert_guest, safe_create_order, Venmo deep link, order
 * confirmation notification) — wrapped in an overlay + inline guest
 * info form. On success replaces the body with a confirmation
 * pointing to /my-tickets.
 */
function CartCheckoutModal({
  cart,
  event,
  settings,
  existingRsvp,
  onClose,
  onAdjust,
  onClearCart,
}: {
  cart: CartItem[]
  event: Event
  settings: AdminSettings | null
  existingRsvp: RSVP | null
  onClose: () => void
  onAdjust: (item: MenuItem, delta: number) => void
  onClearCart: () => void
}) {
  const { addToast } = useToast()
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null)
  const [paymentLinkType, setPaymentLinkType] = useState<'deep_link' | 'web_url'>('web_url')
  // RSVP gate (USER_FLOWS_SPEC.md §4.2). Only shown when the guest has
  // no prior RSVP for this event — returning RSVPs (any status, including
  // 'no'/'waitlisted') skip the gate so we don't re-ask at every checkout.
  const showRsvpGate = !existingRsvp
  const [rsvpStatus, setRsvpStatus] = useState<'yes' | 'maybe' | 'no' | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const needsAck = rsvpStatus === 'no' || rsvpStatus === 'maybe'

  const smsEnabled = !!settings?.sms_enabled
  const total = cart.reduce(
    (sum, c) => sum + (c.menuItem.price ?? 0) * c.quantity,
    0,
  )

  // Pre-fill from localStorage guest if signed in.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = getGuestToken()
      if (!token) return
      const { data } = await supabase.rpc('get_my_guest', { p_guest_id: token })
      if (cancelled || !data) return
      setFirstName(data.first_name ?? '')
      if (data.email) setEmail(data.email)
      if (data.phone) setPhone(data.phone)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Lock body scroll + Escape closes.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, submitting])

  async function handleSubmit() {
    if (cart.length === 0) return
    if (!firstName.trim()) {
      addToast('What name should we put on it?', 'error')
      return
    }
    if (smsEnabled ? !email.trim() && !phone.trim() : !email.trim()) {
      addToast(
        smsEnabled
          ? 'Email or phone, please — we send a confirmation.'
          : 'Email, please — we send a confirmation.',
        'error',
      )
      return
    }
    if (showRsvpGate) {
      if (!rsvpStatus) {
        addToast('Tell us if you can make the event before checking out.', 'error')
        return
      }
      if (needsAck && !acknowledged) {
        addToast('Acknowledge the post-event pickup before checking out.', 'error')
        return
      }
    }
    if (!settings?.venmo_handle) {
      addToast('Venmo handle not configured. Tell the host.', 'error')
      return
    }

    setSubmitting(true)
    try {
      const fields: Record<string, unknown> = {
        first_name: firstName.trim(),
        email: email.trim() || null,
      }
      if (smsEnabled) {
        fields.phone = phone.trim() ? normalizePhone(phone.trim()) : null
      }
      const { data: guest, error: guestErr } = await supabase.rpc(
        'upsert_guest',
        { p_fields: fields, p_guest_id: getGuestToken() },
      )
      if (guestErr) throw guestErr
      if (!guest) throw new Error('Failed to create guest')
      const guestId = guest.id as string
      setGuestToken(guestId)

      const pendingMerge = (guest as { pending_merge?: PendingMerge }).pending_merge
      if (pendingMerge?.verification_token) {
        void dispatchMergeVerification(pendingMerge)
      }

      // RSVP guardrail: commit the chosen status before the order so the
      // host has an accurate seat count alongside the food order. Plus-one
      // cleanup on 'no'/'maybe' is handled by the sync_plus_one_status
      // trigger (mig 034). Skipped for returning guests — they keep
      // whatever RSVP they already have.
      if (showRsvpGate && rsvpStatus) {
        const { data: rsvpResult, error: rsvpError } = await supabase.rpc(
          'safe_create_rsvp',
          {
            p_event_id: event.id,
            p_guest_id: guestId,
            p_status: rsvpStatus,
          },
        )
        if (rsvpError) throw rsvpError
        if (rsvpStatus !== 'no') {
          sendNotification({
            guestId,
            eventId: event.id,
            type: 'rsvp_confirmation',
            data: {
              status: rsvpResult?.status || rsvpStatus,
              is_ticketed: event.ticketing_enabled ? 'true' : 'false',
            },
          })
        }
      }

      const venmoNote = buildVenmoNote({
        firstName: firstName.trim(),
        eventTitle: event.title,
        items: cart.map(c => ({ name: c.menuItem.name, quantity: c.quantity })),
      })
      const { data: order, error: orderErr } = await supabase.rpc(
        'safe_create_order',
        {
          p_event_id: event.id,
          p_guest_id: guestId,
          p_total: total,
          p_venmo_note: venmoNote,
          p_payment_method: 'venmo',
          p_items: cart.map(c => ({
            menu_item_id: c.menuItem.id,
            quantity: c.quantity,
            unit_price: c.menuItem.price,
          })),
        },
      )
      if (orderErr) {
        const msg = orderErr.message || ''
        if (msg.includes('OUT_OF_STOCK')) {
          throw new Error(msg.replace(/.*OUT_OF_STOCK:\s*/, ''))
        }
        throw orderErr
      }
      if (!order) throw new Error('Failed to create order')

      const provider = getPaymentProvider('venmo')
      const paymentGuest = { id: guestId, first_name: firstName.trim() } as never
      const paymentLink = provider.generatePaymentLink(
        order,
        paymentGuest,
        event,
        settings.venmo_handle,
      )

      sendNotification({
        guestId,
        eventId: event.id,
        type: 'order_confirmation',
        data: { order_id: order.id as string },
      })

      // Stash the link first so the receipt can render an <a href> as a
      // fallback if the auto-handoff below doesn't fire (e.g. Venmo not
      // installed). Then navigate same-tab to the deep link — iOS/Android
      // intercept venmo:// at navigation time and open the app.
      setPaymentUrl(paymentLink.url)
      setPaymentLinkType(paymentLink.type)
      setSubmitted(true)
      openPaymentLink(paymentLink)
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to submit order', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pre-order checkout"
      onClick={() => {
        if (!submitting) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(13, 13, 15, 0.78)',
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
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '8px 8px 0 var(--ck-ink)',
          color: 'var(--ck-ink)',
        }}
      >
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '2px solid var(--ck-ink)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
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
              ✦ Pre-order
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
              {submitted ? 'You’re set.' : 'Your cart.'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 28,
              lineHeight: 1,
              cursor: submitting ? 'not-allowed' : 'pointer',
              color: 'var(--ck-ink)',
              padding: 0,
              opacity: submitting ? 0.5 : 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: 22 }}>
          {submitted ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div
                style={{
                  fontFamily: 'var(--ck-arabic-display)',
                  fontSize: 56,
                  color: 'var(--ck-cobalt)',
                  direction: 'rtl',
                  lineHeight: 1,
                }}
              >
                صحتين
              </div>
              <h3
                style={{
                  fontFamily: 'var(--ck-serif)',
                  fontWeight: 900,
                  fontSize: 28,
                  lineHeight: 1,
                  margin: '12px 0 8px',
                }}
              >
                ORDER CAPTURED.
              </h3>
              <p
                className="ck-italic"
                style={{ fontSize: 16, lineHeight: 1.5, margin: '0 auto', maxWidth: 380 }}
              >
                Venmo opened to finish payment — come back here when it's
                sent. We emailed a confirmation; the host marks it paid.
              </p>
              <div
                style={{
                  marginTop: 18,
                  padding: 12,
                  border: '2px solid var(--ck-ink)',
                  background: 'var(--ck-paper)',
                  fontFamily: 'var(--ck-mono)',
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  lineHeight: 1.5,
                }}
              >
                See this order anytime at{' '}
                <Link
                  to="/my-tickets"
                  style={{ color: 'var(--ck-cobalt)', textDecoration: 'underline' }}
                >
                  My Tickets &amp; Orders
                </Link>
              </div>
              {paymentUrl && (
                <p
                  style={{
                    marginTop: 14,
                    fontFamily: 'var(--ck-mono)',
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    opacity: 0.7,
                    lineHeight: 1.6,
                  }}
                >
                  Venmo didn't open?{' '}
                  <a
                    href={paymentUrl}
                    target={paymentLinkType === 'deep_link' ? undefined : '_blank'}
                    rel="noopener noreferrer"
                    style={{ color: 'var(--ck-cobalt)', textDecoration: 'underline' }}
                  >
                    Tap here to retry
                  </a>
                  .
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  onClearCart()
                  onClose()
                }}
                className="ck-btn"
                style={{ marginTop: 22 }}
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 18 }}>
                {cart.map(c => (
                  <div
                    key={c.menuItem.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto',
                      gap: 10,
                      alignItems: 'center',
                      padding: '10px 0',
                      borderBottom: '1px dashed var(--ck-ink)',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: 'var(--ck-serif)',
                          fontWeight: 800,
                          fontSize: 16,
                          lineHeight: 1.2,
                        }}
                      >
                        {c.menuItem.name}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--ck-mono)',
                          fontSize: 10,
                          letterSpacing: '0.14em',
                          textTransform: 'uppercase',
                          opacity: 0.65,
                          marginTop: 2,
                        }}
                      >
                        ${(c.menuItem.price ?? 0).toFixed(2)} each
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => onAdjust(c.menuItem, -1)}
                        aria-label={`Remove one ${c.menuItem.name}`}
                        style={cartStepBtnStyle}
                      >
                        −
                      </button>
                      <span
                        style={{
                          fontFamily: 'var(--ck-serif)',
                          fontWeight: 800,
                          fontSize: 16,
                          minWidth: 22,
                          textAlign: 'center',
                        }}
                      >
                        {c.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onAdjust(c.menuItem, 1)}
                        aria-label={`Add another ${c.menuItem.name}`}
                        style={cartStepBtnStyle}
                      >
                        +
                      </button>
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--ck-serif)',
                        fontWeight: 800,
                        fontSize: 16,
                        textAlign: 'right',
                        minWidth: 60,
                      }}
                    >
                      ${((c.menuItem.price ?? 0) * c.quantity).toFixed(2)}
                    </div>
                  </div>
                ))}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingTop: 12,
                    fontFamily: 'var(--ck-serif)',
                    fontWeight: 900,
                    fontSize: 20,
                  }}
                >
                  <span>Total</span>
                  <span>${total.toFixed(2)}</span>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div>
                  <label className="ck-label">Name</label>
                  <input
                    className="ck-input"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    placeholder="Your first name"
                  />
                </div>
                {smsEnabled && (
                  <div>
                    <label className="ck-label">Phone (optional)</label>
                    <input
                      className="ck-input"
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="(555) 555-5555"
                    />
                  </div>
                )}
                <div>
                  <label className="ck-label">Email</label>
                  <input
                    className="ck-input"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              {/* RSVP guardrail (USER_FLOWS_SPEC.md §4.2). Hidden for
                  returning guests who already RSVP'd. 'no' / 'maybe'
                  demand an acknowledgment that the guest will arrange
                  post-event pickup with the host. */}
              {showRsvpGate && (
                <div
                  style={{
                    marginTop: 18,
                    paddingTop: 18,
                    borderTop: '2px solid var(--ck-ink)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div className="ck-eyebrow" style={{ color: 'var(--ck-cobalt)' }}>
                    ✦ Btw, are you coming?
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(
                      [
                        { value: 'yes', label: "I'm going" },
                        { value: 'maybe', label: 'Maybe' },
                        { value: 'no', label: "Can't come" },
                      ] as const
                    ).map(opt => (
                      <button
                        type="button"
                        key={opt.value}
                        onClick={() => setRsvpStatus(opt.value)}
                        className={
                          rsvpStatus === opt.value
                            ? 'ck-btn ck-btn--primary'
                            : 'ck-btn'
                        }
                        style={{ flex: '1 1 100px' }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {needsAck && (
                    <label
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'flex-start',
                        padding: 12,
                        border: '2px solid var(--ck-ink)',
                        background: 'var(--ck-paper)',
                        cursor: 'pointer',
                        fontFamily: 'var(--ck-sans)',
                        fontSize: 13,
                        lineHeight: 1.45,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={e => setAcknowledged(e.target.checked)}
                        style={{
                          width: 16,
                          height: 16,
                          marginTop: 2,
                          accentColor: 'var(--ck-cobalt)',
                          flexShrink: 0,
                        }}
                      />
                      <span>
                        I acknowledge that I'm ordering items but can't
                        attend the event, so I'm going to arrange with the
                        host to pick them up within 24 hours after the event.
                      </span>
                    </label>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        {!submitted && (
          <div
            style={{
              padding: '16px 22px',
              borderTop: '2px solid var(--ck-ink)',
              background: 'var(--ck-paper)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                submitting ||
                cart.length === 0 ||
                (showRsvpGate && (!rsvpStatus || (needsAck && !acknowledged)))
              }
              className="ck-btn ck-btn--primary ck-btn--block"
            >
              {submitting ? 'Sending you to Venmo…' : `Pay $${total.toFixed(2)} with Venmo →`}
            </button>
            <p
              style={{
                fontFamily: 'var(--ck-mono)',
                fontSize: 9,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                textAlign: 'center',
                opacity: 0.65,
                margin: 0,
              }}
            >
              We capture your order, then hand off to Venmo. Email confirmation included.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function InstagramGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
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
