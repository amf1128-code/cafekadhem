import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type {
  AdminSettings,
  CartItem,
  Event,
  MenuItem,
  MenuItemAvailability,
} from '../lib/types'
import { getGuestToken, setGuestToken } from '../lib/utils/guest-token'
import {
  dispatchMergeVerification,
  type PendingMerge,
} from '../lib/identity/handlePendingMerge'
import { ConsentNote } from '../components/ui/ConsentNote'
import { normalizePhone } from '../lib/utils/phone'
import { getPaymentProvider } from '../lib/payment'
import { sendNotification } from '../lib/notifications'
import { useToast } from '../components/ui/Toast'
import { CinemaPageLoader } from '../components/cinema/primitives'

/**
 * /events/:id/order — full pre-order flow. Same RPCs as the inline cart
 * on /events/:id (safe_create_order, upsert_guest, Venmo deep-link via
 * getPaymentProvider, sendNotification('order_confirmation')). Cinema-
 * styled in line with the rest of the public site.
 */
export function Order() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [event, setEvent] = useState<Event | null>(null)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [availability, setAvailability] = useState<
    Record<string, { max: number; sold: number }>
  >({})
  const [cart, setCart] = useState<CartItem[]>([])
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null)
  const [paymentLinkType, setPaymentLinkType] = useState<'deep_link' | 'web_url'>('web_url')
  const [paidAmount, setPaidAmount] = useState(0)

  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  useEffect(() => {
    if (id) loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadData() {
    const [eventResult, settingsResult] = await Promise.all([
      supabase.from('events').select('*').eq('id', id!).single(),
      supabase.from('admin_settings').select('*').limit(1).single(),
    ])

    if (eventResult.data) {
      setEvent(eventResult.data)
      if (eventResult.data.menu_id) {
        const [{ data: items }, { data: avail }] = await Promise.all([
          supabase
            .from('public_menu_items')
            .select('*')
            .eq('menu_id', eventResult.data.menu_id)
            .eq('is_available', true)
            .order('sort_order'),
          supabase.rpc('event_menu_item_availability', { p_event_id: id! }),
        ])
        if (items) setMenuItems(items)
        if (avail) {
          const map: Record<string, { max: number; sold: number }> = {}
          for (const row of avail as MenuItemAvailability[]) {
            map[row.menu_item_id] = { max: row.max_quantity, sold: row.sold_quantity }
          }
          setAvailability(map)
        }
      }
    }

    if (settingsResult.data) setSettings(settingsResult.data)

    const guestToken = getGuestToken()
    if (guestToken) {
      const { data: guest } = await supabase.rpc('get_my_guest', {
        p_guest_id: guestToken,
      })
      if (guest) {
        setFirstName(guest.first_name)
        if (guest.email) setEmail(guest.email)
        if (guest.phone) setPhone(guest.phone)
      }
    }

    setLoading(false)
  }

  function remainingFor(itemId: string): number | null {
    const a = availability[itemId]
    if (!a) return null
    return Math.max(a.max - a.sold, 0)
  }

  function updateCart(item: MenuItem, delta: number) {
    setCart(prev => {
      const existing = prev.find(c => c.menuItem.id === item.id)
      if (existing) {
        const newQty = existing.quantity + delta
        if (newQty <= 0) return prev.filter(c => c.menuItem.id !== item.id)
        const remaining = remainingFor(item.id)
        if (delta > 0 && remaining !== null && newQty > remaining) {
          addToast(`Only ${remaining} of ${item.name} left`, 'error')
          return prev
        }
        return prev.map(c =>
          c.menuItem.id === item.id ? { ...c, quantity: newQty } : c,
        )
      }
      if (delta > 0) {
        const remaining = remainingFor(item.id)
        if (remaining !== null && remaining < 1) {
          addToast(`${item.name} is sold out`, 'error')
          return prev
        }
        return [...prev, { menuItem: item, quantity: 1 }]
      }
      return prev
    })
  }

  const total = cart.reduce(
    (sum, item) => sum + (item.menuItem.price || 0) * item.quantity,
    0,
  )

  async function handleSubmit() {
    if (cart.length === 0) return
    if (!firstName.trim()) {
      addToast('Please provide your name.', 'error')
      return
    }
    const smsEnabled = !!settings?.sms_enabled
    if (smsEnabled ? !email.trim() && !phone.trim() : !email.trim()) {
      addToast(
        smsEnabled
          ? 'Please provide an email or phone.'
          : 'Please provide an email address.',
        'error',
      )
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

      const venmoNote = `${firstName.trim()} - ${event!.title}`

      const { data: order, error: orderErr } = await supabase.rpc(
        'safe_create_order',
        {
          p_event_id: id!,
          p_guest_id: guestId,
          p_total: total,
          p_venmo_note: venmoNote,
          p_payment_method: 'venmo',
          p_items: cart.map(item => ({
            menu_item_id: item.menuItem.id,
            quantity: item.quantity,
            unit_price: item.menuItem.price,
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

      if (!settings?.venmo_handle) {
        throw new Error(
          'Venmo handle not configured — please set it in admin settings',
        )
      }
      const provider = getPaymentProvider('venmo')
      const paymentGuest = { id: guestId, first_name: firstName.trim() } as never
      const paymentLink = provider.generatePaymentLink(
        order,
        paymentGuest,
        event!,
        settings.venmo_handle,
      )

      sendNotification({
        guestId,
        eventId: id!,
        type: 'order_confirmation',
      })

      // Show the Venmo handoff as a tappable anchor on the receipt; on
      // mobile, programmatic window.open of a venmo:// URL doesn't launch
      // the app. Anchor tags do (same pattern as the RSVP/ticket flow).
      setPaymentUrl(paymentLink.url)
      setPaymentLinkType(paymentLink.type)
      setPaidAmount(total)
      setSubmitted(true)
      addToast('Order submitted!')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to submit order', 'error')
    } finally {
      setSubmitting(false)
    }
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

  if (submitted) {
    return (
      <section className="ck-page" style={{ textAlign: 'center', borderBottom: 'none' }}>
        <div className="ck-narrow">
          <div
            style={{
              fontFamily: 'var(--ck-arabic-display)',
              fontSize: 'clamp(48px, 6vw, 72px)',
              color: 'var(--ck-cobalt)',
              direction: 'rtl',
              lineHeight: 1,
            }}
          >
            صحتين
          </div>
          <h1 className="ck-h1" style={{ marginTop: 12 }}>
            ORDER CAPTURED.
          </h1>
          <p
            className="ck-italic"
            style={{ fontSize: 18, marginTop: 18, lineHeight: 1.5 }}
          >
            One last step — tap below to send payment via Venmo. We
            emailed a confirmation; the host marks it paid.
          </p>
          {paymentUrl && (
            <a
              href={paymentUrl}
              target={paymentLinkType === 'deep_link' ? undefined : '_blank'}
              rel="noopener noreferrer"
              className="ck-btn ck-btn--primary"
              style={{ marginTop: 22, display: 'inline-block' }}
            >
              Pay ${paidAmount.toFixed(2)} on Venmo →
            </a>
          )}
          <div
            style={{
              marginTop: 18,
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Link to="/my-tickets" className="ck-btn">
              See my tickets &amp; orders →
            </Link>
            <Link to={`/events/${event.id}`} className="ck-btn">
              Back to event
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const categories = Array.from(new Set(menuItems.map(i => i.category || 'Other')))
  const smsEnabled = !!settings?.sms_enabled

  return (
    <>
      <section className="ck-page">
        <div className="ck-eyebrow">✦ Pre-order</div>
        <div
          className="ck-section-head-row"
          style={{ marginTop: 6, alignItems: 'baseline' }}
        >
          <h1 className="ck-h1">{event.title.toUpperCase()}</h1>
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
        <p
          className="ck-italic"
          style={{ fontSize: 18, marginTop: 14, color: 'var(--ck-cobalt)' }}
        >
          Reserve what you want before you walk in.
        </p>
      </section>

      {/* Menu by category */}
      <section className="ck-page ck-page--paper">
        {menuItems.length === 0 ? (
          <div className="ck-italic" style={{ fontSize: 18, opacity: 0.7 }}>
            No menu attached to this event yet.
          </div>
        ) : (
          categories.map(cat => (
            <div key={cat} style={{ marginBottom: 32 }}>
              <div className="ck-eyebrow" style={{ marginBottom: 14 }}>
                {cat}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 0,
                  border: '2px solid var(--ck-ink)',
                  background: 'var(--ck-cream)',
                }}
              >
                {menuItems
                  .filter(i => (i.category || 'Other') === cat)
                  .map((item, idx) => {
                    const inCart = cart.find(c => c.menuItem.id === item.id)
                    const remaining = remainingFor(item.id)
                    const cartQty = inCart?.quantity || 0
                    const atCap = remaining !== null && cartQty >= remaining
                    const soldOut = remaining !== null && remaining <= 0 && cartQty === 0
                    return (
                      <div
                        key={item.id}
                        style={{
                          padding: 20,
                          borderRight: '2px solid var(--ck-ink)',
                          borderBottom: '2px solid var(--ck-ink)',
                          background:
                            idx % 2 === 0 ? 'var(--ck-cream)' : 'var(--ck-paper)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          minHeight: 180,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            gap: 10,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'var(--ck-serif)',
                              fontWeight: 800,
                              fontSize: 22,
                              lineHeight: 1.05,
                              textTransform: 'uppercase',
                            }}
                          >
                            {item.name}
                          </span>
                          {item.display_arabic && (
                            <span
                              style={{
                                fontFamily: 'var(--ck-arabic-display)',
                                fontSize: 22,
                                direction: 'rtl',
                                color: 'var(--ck-cobalt)',
                                lineHeight: 1,
                              }}
                            >
                              {item.display_arabic}
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <div
                            style={{
                              fontFamily: 'var(--ck-sans)',
                              fontSize: 13,
                              lineHeight: 1.5,
                            }}
                          >
                            {item.description}
                          </div>
                        )}
                        {remaining !== null && remaining <= 3 && remaining > 0 && (
                          <div
                            className="ck-mono"
                            style={{ fontSize: 9, color: 'var(--ck-magenta)' }}
                          >
                            Only {remaining} left
                          </div>
                        )}
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
                            {item.price ? `$${Math.round(item.price)}` : '—'}
                          </span>
                          {soldOut ? (
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
                              onClick={() => updateCart(item, 1)}
                              disabled={!item.price}
                              className="ck-btn ck-btn--primary"
                              style={{ padding: '8px 14px', fontSize: 11 }}
                            >
                              + Add
                            </button>
                          ) : (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => updateCart(item, -1)}
                                style={stepBtn}
                                aria-label={`Remove one ${item.name}`}
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
                                onClick={() => updateCart(item, 1)}
                                disabled={atCap}
                                style={{
                                  ...stepBtn,
                                  opacity: atCap ? 0.4 : 1,
                                  cursor: atCap ? 'not-allowed' : 'pointer',
                                }}
                                aria-label={`Add another ${item.name}`}
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          ))
        )}
      </section>

      {/* Order summary + checkout */}
      <section className="ck-page" style={{ borderBottom: 'none' }}>
        <div className="ck-narrow">
          <div className="ck-eyebrow">Order summary</div>
          <h2 className="ck-h2" style={{ marginTop: 6 }}>
            YOUR CART.
          </h2>

          {cart.length === 0 ? (
            <p
              className="ck-italic"
              style={{ fontSize: 18, marginTop: 14, opacity: 0.7 }}
            >
              Add items above to start an order.
            </p>
          ) : (
            <div
              className="ck-card"
              style={{ marginTop: 22, padding: 20 }}
            >
              {cart.map(item => (
                <div
                  key={item.menuItem.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom: '1px dashed var(--ck-ink)',
                    fontFamily: 'var(--ck-serif)',
                  }}
                >
                  <span style={{ fontWeight: 700 }}>
                    {item.menuItem.name}{' '}
                    <span style={{ opacity: 0.55 }}>× {item.quantity}</span>
                  </span>
                  <span style={{ fontWeight: 800 }}>
                    ${((item.menuItem.price || 0) * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  paddingTop: 14,
                  fontFamily: 'var(--ck-serif)',
                  fontWeight: 900,
                  fontSize: 22,
                }}
              >
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </div>
          )}

          <div
            className="ck-card"
            style={{
              marginTop: 22,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div className="ck-eyebrow">Your info</div>
            <div>
              <label className="ck-label">Name</label>
              <input
                className="ck-input"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="Your first name"
              />
            </div>
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
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || cart.length === 0}
            className="ck-btn ck-btn--primary ck-btn--block"
            style={{ marginTop: 22 }}
          >
            {submitting
              ? 'Sending you to Venmo…'
              : `Pay $${total.toFixed(2)} with Venmo →`}
          </button>
          <p
            style={{
              fontFamily: 'var(--ck-mono)',
              fontSize: 9,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              textAlign: 'center',
              opacity: 0.65,
              marginTop: 10,
            }}
          >
            We capture your order, then hand off to Venmo. Email confirmation included.
          </p>
          <ConsentNote verb="order" />
        </div>
      </section>
    </>
  )
}

const stepBtn: React.CSSProperties = {
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
