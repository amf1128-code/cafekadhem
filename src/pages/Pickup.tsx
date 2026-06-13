import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type {
  AdminSettings,
  CartItem,
  MenuItem,
  MenuItemAvailability,
  PickupConfig,
  PickupSlot,
} from '../lib/types'
import { getGuestToken, setGuestToken } from '../lib/utils/guest-token'
import { cartTotal } from '../lib/utils/cart'
import { formatUsd } from '../lib/utils/money'
import {
  dispatchMergeVerification,
  type PendingMerge,
} from '../lib/identity/handlePendingMerge'
import { ConsentNote } from '../components/ui/ConsentNote'
import { normalizePhone } from '../lib/utils/phone'
import { formatTime } from '../lib/utils/date'
import { getPaymentProvider, openPaymentLink } from '../lib/payment'
import { buildVenmoNote } from '../lib/payment/venmo'
import { sendNotification } from '../lib/notifications'
import { useToast } from '../components/ui/Toast'
import { CinemaPageLoader } from '../components/cinema/primitives'

/**
 * /pickup — out-of-event pickup ordering. Same RPC + Venmo flow as
 * /events/:id/order; the only differences are the slot picker and the
 * admin-controlled pickup_config (which menu, which days/times). Cinema-
 * styled.
 */
export function Pickup() {
  const { addToast } = useToast()
  const [config, setConfig] = useState<PickupConfig | null>(null)
  const [slots, setSlots] = useState<PickupSlot[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [availability, setAvailability] = useState<
    Record<string, { max: number; sold: number }>
  >({})
  const [cart, setCart] = useState<CartItem[]>([])
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<{
    pickupToken: string
    paymentUrl: string
    paymentLinkType: 'deep_link' | 'web_url'
    amount: number
    when: string
  } | null>(null)

  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')

  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadData() {
    const [configResult, settingsResult] = await Promise.all([
      supabase
        .from('pickup_config')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .single(),
      supabase.from('admin_settings').select('*').limit(1).single(),
    ])

    if (configResult.data) {
      setConfig(configResult.data)

      const [slotsResult, itemsResult, availResult] = await Promise.all([
        supabase
          .from('pickup_slots')
          .select('*')
          .eq('pickup_config_id', configResult.data.id)
          .eq('is_active', true)
          .order('day_of_week')
          .order('start_time'),
        configResult.data.menu_id
          ? supabase
              .from('public_menu_items')
              .select('*')
              .eq('menu_id', configResult.data.menu_id)
              .eq('is_available', true)
              .order('sort_order')
          : Promise.resolve({ data: [] }),
        supabase.rpc('pickup_menu_item_availability', {
          p_pickup_config_id: configResult.data.id,
        }),
      ])

      if (slotsResult.data) setSlots(slotsResult.data)
      if (itemsResult.data) setMenuItems(itemsResult.data)
      if (availResult.data) {
        const map: Record<string, { max: number; sold: number }> = {}
        for (const row of availResult.data as MenuItemAvailability[]) {
          map[row.menu_item_id] = { max: row.max_quantity, sold: row.sold_quantity }
        }
        setAvailability(map)
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

  // 14-day window of dates that have at least one slot.
  const availableDates = useMemo(() => {
    const dates: { date: string; label: string; dayOfWeek: number }[] = []
    const today = new Date()
    for (let i = 1; i <= 14; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      const dow = d.getDay()
      if (slots.some(s => s.day_of_week === dow)) {
        const dateStr = d.toISOString().split('T')[0]
        const label = d.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
        dates.push({ date: dateStr, label, dayOfWeek: dow })
      }
    }
    return dates
  }, [slots])

  const availableTimes = useMemo(() => {
    if (!selectedDate) return []
    const selected = availableDates.find(d => d.date === selectedDate)
    if (!selected) return []
    return slots.filter(s => s.day_of_week === selected.dayOfWeek)
  }, [selectedDate, availableDates, slots])

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

  const total = cartTotal(cart)

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
    if (!selectedDate || !selectedTime) {
      addToast('Please select a pickup date and time.', 'error')
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

      const venmoNote = buildVenmoNote({
        firstName: firstName.trim(),
        eventTitle: `Pickup ${selectedDate}`,
        items: cart.map(c => ({ name: c.menuItem.name, quantity: c.quantity })),
      })

      const { data: order, error: orderErr } = await supabase.rpc(
        'safe_create_pickup_order',
        {
          p_guest_id: guestId,
          p_menu_id: config!.menu_id!,
          p_pickup_date: selectedDate,
          p_pickup_time: selectedTime,
          p_total: total,
          p_venmo_note: venmoNote,
          p_notes: notes.trim() || null,
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

      if (!settings?.venmo_handle) throw new Error('Venmo handle not configured')
      const provider = getPaymentProvider('venmo')
      const paymentGuest = { id: guestId, first_name: firstName.trim() } as never
      const fakeEvent = { title: `Pickup ${selectedDate}` } as never
      const paymentLink = provider.generatePaymentLink(
        { ...order, total } as never,
        paymentGuest,
        fakeEvent,
        settings.venmo_handle,
      )

      const pickupWhen = `${new Date(selectedDate + 'T00:00:00').toLocaleDateString(
        'en-US',
        { weekday: 'long', month: 'long', day: 'numeric' },
      )} at ${formatTime(selectedTime)}`

      sendNotification({
        guestId,
        type: 'pickup_order_confirmation',
        data: {
          pickup_when: pickupWhen,
          pickup_token: order.pickup_token,
        },
      })

      // Stash the link so the receipt can render a fallback anchor, then
      // hand off same-tab to Venmo (window.open with _blank doesn't open
      // the app for venmo:// on mobile).
      setSubmitted({
        pickupToken: order.pickup_token,
        paymentUrl: paymentLink.url,
        paymentLinkType: paymentLink.type,
        amount: total,
        when: pickupWhen,
      })
      addToast('Order submitted!')
      openPaymentLink(paymentLink)
      return
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to submit order', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <CinemaPageLoader />

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
            style={{ fontSize: 18, marginTop: 14, lineHeight: 1.5 }}
          >
            Pick up: {submitted.when}.
          </p>
          <p
            className="ck-italic"
            style={{ fontSize: 18, marginTop: 8, lineHeight: 1.5 }}
          >
            Venmo opened to finish payment — come back here when it's
            sent. We emailed a confirmation; the host marks it paid.
          </p>
          <div
            style={{
              marginTop: 22,
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Link
              to={`/pickup/${submitted.pickupToken}`}
              className="ck-btn ck-btn--primary"
            >
              See pickup ticket →
            </Link>
            <Link to="/my-tickets" className="ck-btn">
              My tickets &amp; orders
            </Link>
          </div>
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
              href={submitted.paymentUrl}
              target={submitted.paymentLinkType === 'deep_link' ? undefined : '_blank'}
              rel="noopener noreferrer"
              style={{ color: 'var(--ck-cobalt)', textDecoration: 'underline' }}
            >
              Tap here to retry ({formatUsd(submitted.amount)})
            </a>
            .
          </p>
        </div>
      </section>
    )
  }

  if (!config || !config.menu_id) {
    return (
      <section className="ck-page" style={{ textAlign: 'center', borderBottom: 'none' }}>
        <div className="ck-narrow">
          <div className="ck-eyebrow">✦ Pick-up</div>
          <h1 className="ck-h1" style={{ marginTop: 12 }}>
            CLOSED FOR
            <br />
            <span className="ck-italic">pickup</span>
          </h1>
          <p
            className="ck-italic"
            style={{ fontSize: 18, marginTop: 18, lineHeight: 1.5 }}
          >
            We&apos;re not taking pickup orders right now. Check back soon —
            or come to a pop-up.
          </p>
          <Link to="/" className="ck-btn ck-btn--primary" style={{ marginTop: 28 }}>
            Back home →
          </Link>
        </div>
      </section>
    )
  }

  const categories = Array.from(new Set(menuItems.map(i => i.category || 'Other')))
  const smsEnabled = !!settings?.sms_enabled

  return (
    <>
      <section className="ck-page">
        <div className="ck-eyebrow">✦ Pick-up order</div>
        <div
          className="ck-section-head-row"
          style={{ marginTop: 6, alignItems: 'baseline' }}
        >
          <h1 className="ck-h1">PICK-UP.</h1>
          <span
            style={{
              fontFamily: 'var(--ck-arabic-display)',
              fontSize: 'clamp(48px, 6vw, 72px)',
              direction: 'rtl',
              color: 'var(--ck-cobalt)',
              lineHeight: 0.9,
            }}
          >
            استلام
          </span>
        </div>
        <p
          className="ck-italic"
          style={{ fontSize: 18, marginTop: 14, color: 'var(--ck-cobalt)' }}
        >
          Pick a day, pick the goods, pay over Venmo. Walk in and grab it.
        </p>
      </section>

      {/* Menu */}
      <section className="ck-page ck-page--paper">
        <div className="ck-eyebrow" style={{ marginBottom: 20 }}>
          The menu
        </div>
        {menuItems.length === 0 ? (
          <p className="ck-italic" style={{ fontSize: 17, opacity: 0.7 }}>
            No items available right now.
          </p>
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

      {/* Slot picker + summary + checkout */}
      <section className="ck-page" style={{ borderBottom: 'none' }}>
        <div className="ck-narrow">
          <div className="ck-eyebrow">When</div>
          <h2 className="ck-h2" style={{ marginTop: 6 }}>
            PICK A SLOT.
          </h2>
          <div className="ck-card" style={{ marginTop: 18, padding: 20 }}>
            {availableDates.length === 0 ? (
              <p className="ck-italic" style={{ fontSize: 17, opacity: 0.7 }}>
                No pickup times available right now.
              </p>
            ) : (
              <>
                <div className="ck-label" style={{ marginBottom: 8 }}>
                  Date
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    marginBottom: 18,
                  }}
                >
                  {availableDates.map(d => (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => {
                        setSelectedDate(d.date)
                        setSelectedTime('')
                      }}
                      className="ck-btn"
                      style={
                        selectedDate === d.date
                          ? {
                              background: 'var(--ck-cobalt)',
                              color: 'var(--ck-cream)',
                            }
                          : undefined
                      }
                    >
                      {d.label}
                    </button>
                  ))}
                </div>

                {selectedDate && availableTimes.length > 0 && (
                  <>
                    <div className="ck-label" style={{ marginBottom: 8 }}>
                      Time
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {availableTimes.map(slot => (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => setSelectedTime(slot.start_time)}
                          className="ck-btn"
                          style={
                            selectedTime === slot.start_time
                              ? {
                                  background: 'var(--ck-cobalt)',
                                  color: 'var(--ck-cream)',
                                }
                              : undefined
                          }
                        >
                          {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {cart.length > 0 && (
            <>
              <div className="ck-eyebrow" style={{ marginTop: 26 }}>
                Order
              </div>
              <h2 className="ck-h2" style={{ marginTop: 6 }}>
                YOUR CART.
              </h2>
              <div className="ck-card" style={{ marginTop: 18, padding: 20 }}>
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
                      {formatUsd((item.menuItem.price || 0) * item.quantity)}
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
                  <span>{formatUsd(total)}</span>
                </div>
              </div>
            </>
          )}

          <div className="ck-eyebrow" style={{ marginTop: 26 }}>
            Your info
          </div>
          <div
            className="ck-card"
            style={{
              marginTop: 14,
              padding: 20,
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
            <div>
              <label className="ck-label">Notes (optional)</label>
              <input
                className="ck-input"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any special requests"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              submitting || cart.length === 0 || !selectedDate || !selectedTime
            }
            className="ck-btn ck-btn--primary ck-btn--block"
            style={{ marginTop: 22 }}
          >
            {submitting
              ? 'Sending you to Venmo…'
              : `Pay ${formatUsd(total)} with Venmo →`}
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
            Venmo opens in a new tab. We email you a confirmation + QR
            ticket.
          </p>
          <ConsentNote verb="pickup" />
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
