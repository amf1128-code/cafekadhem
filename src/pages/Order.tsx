import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Event, MenuItem, AdminSettings, CartItem, MenuItemAvailability } from '../lib/types'
import { getGuestToken, setGuestToken } from '../lib/utils/guest-token'
import { normalizePhone } from '../lib/utils/phone'
import { getPaymentProvider } from '../lib/payment'
import { sendNotification } from '../lib/notifications'
import { PageLoader } from '../components/ui/LoadingSpinner'
import { useToast } from '../components/ui/Toast'
import { usePageTheme } from '../lib/theme/themes'

export function Order() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [event, setEvent] = useState<Event | null>(null)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [availability, setAvailability] = useState<Record<string, { max: number; sold: number }>>({})
  const [cart, setCart] = useState<CartItem[]>([])
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Guest info
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  usePageTheme(event?.theme)

  useEffect(() => {
    if (id) loadData()
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

    // Pre-fill guest info if returning
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
        if (newQty <= 0) {
          return prev.filter(c => c.menuItem.id !== item.id)
        }
        const remaining = remainingFor(item.id)
        if (delta > 0 && remaining !== null && newQty > remaining) {
          addToast(`Only ${remaining} of ${item.name} left`, 'error')
          return prev
        }
        return prev.map(c =>
          c.menuItem.id === item.id ? { ...c, quantity: newQty } : c
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

  const total = cart.reduce((sum, item) => sum + (item.menuItem.price || 0) * item.quantity, 0)

  async function handleSubmit() {
    if (cart.length === 0) return
    if (!firstName.trim() || (!email.trim() && !phone.trim())) {
      addToast('Please provide your name and email or phone.', 'error')
      return
    }

    setSubmitting(true)

    try {
      // Single round-trip upsert: dedups by email/phone server-side or
      // updates by id when we already have a localStorage token. Order
      // only collects first/email/phone, so we send only those three —
      // last_name / instagram / notification_preference stay whatever
      // the guest set on a prior form.
      const { data: guest, error: guestErr } = await supabase.rpc('upsert_guest', {
        p_fields: {
          first_name: firstName.trim(),
          email: email.trim() || null,
          phone: phone.trim() ? normalizePhone(phone.trim()) : null,
        },
        p_guest_id: getGuestToken(),
      })
      if (guestErr) throw guestErr
      if (!guest) throw new Error('Failed to create guest')
      const guestId = guest.id
      setGuestToken(guestId)

      const venmoNote = `${firstName.trim()} - ${event!.title}`

      // Place the order through the safe RPC so per-item caps are checked
      // atomically against current sold counts. Server raises OUT_OF_STOCK
      // if anyone else just claimed the last piece.
      const { data: order, error: orderErr } = await supabase.rpc('safe_create_order', {
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
      })

      if (orderErr) {
        const msg = orderErr.message || ''
        if (msg.includes('OUT_OF_STOCK')) {
          throw new Error(msg.replace(/.*OUT_OF_STOCK:\s*/, ''))
        }
        throw orderErr
      }
      if (!order) throw new Error('Failed to create order')

      // Generate payment link
      if (!settings?.venmo_handle) throw new Error('Venmo handle not configured — please set it in admin settings')
      const provider = getPaymentProvider('venmo')
      const paymentGuest = { id: guestId, first_name: firstName.trim() } as any
      const paymentLink = provider.generatePaymentLink(order, paymentGuest, event!, settings.venmo_handle)

      // Open Venmo
      window.open(paymentLink.url, '_blank')

      // Send notification
      sendNotification({
        guestId,
        eventId: id!,
        type: 'order_confirmation',
      })

      setSubmitted(true)
      addToast('Order submitted!')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to submit order', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <PageLoader />

  if (!event) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="font-serif text-xl text-ink-muted italic">Event not found.</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="text-xs tracking-[0.25em] uppercase text-ink-muted mb-4">Order Confirmed</p>
        <h1 className="font-serif text-4xl text-ink italic mb-4">Thank You</h1>
        <p className="font-serif text-lg text-ink-muted italic mb-2">
          Your order has been submitted.
        </p>
        <p className="text-sm text-ink-muted mb-8">
          Payment status will be confirmed by the host.
        </p>
        <Link
          to={`/events/${event.id}`}
          className="inline-block border border-warm px-8 py-3 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors"
        >
          [ Back to Event ]
        </Link>
      </div>
    )
  }

  // Group items by category
  const categories = Array.from(new Set(menuItems.map(i => i.category || 'Other')))

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Header card */}
      <div className="border border-warm bg-parchment-light p-6 md:p-10 mb-8">
        <p className="text-xs tracking-[0.25em] uppercase text-ink-muted mb-2">Pre-Order</p>
        <h1 className="font-serif text-3xl text-ink italic mb-1">{event.title}</h1>
        <div className="border-t border-warm mt-6" />

        {/* Menu Items */}
        <div className="mt-6 space-y-8">
          {categories.map(cat => (
            <div key={cat}>
              <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-4">{cat}</p>
              <div className="space-y-4">
                {menuItems
                  .filter(i => (i.category || 'Other') === cat)
                  .map(item => {
                    const inCart = cart.find(c => c.menuItem.id === item.id)
                    const remaining = remainingFor(item.id)
                    const cartQty = inCart?.quantity || 0
                    const atCap = remaining !== null && cartQty >= remaining
                    const soldOut = remaining !== null && remaining <= 0
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-4 border-b border-warm/50 pb-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-serif text-lg text-ink">{item.name}</p>
                          {item.description && (
                            <p className="font-serif text-sm text-ink-muted italic mt-0.5">{item.description}</p>
                          )}
                          {item.price != null && (
                            <p className="text-sm text-ink mt-1">${item.price.toFixed(2)}</p>
                          )}
                          {soldOut ? (
                            <p className="text-xs uppercase tracking-[0.2em] text-red-700 mt-1">Sold out</p>
                          ) : remaining !== null && remaining <= 3 ? (
                            <p className="text-xs uppercase tracking-[0.2em] text-ink-muted mt-1">
                              Only {remaining} left
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => updateCart(item, -1)}
                            className="w-8 h-8 border border-warm text-ink-muted hover:border-ink hover:text-ink flex items-center justify-center transition-colors text-lg disabled:opacity-30"
                            disabled={!inCart}
                          >
                            &minus;
                          </button>
                          <span className="w-6 text-center font-serif text-lg text-ink">
                            {cartQty}
                          </span>
                          <button
                            onClick={() => updateCart(item, 1)}
                            className="w-8 h-8 border border-warm text-ink-muted hover:border-ink hover:text-ink flex items-center justify-center transition-colors text-lg disabled:opacity-30"
                            disabled={atCap || soldOut}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Order Summary */}
      {cart.length > 0 && (
        <div className="border border-warm bg-parchment-light p-6 md:p-10 mb-8">
          <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-4">Order Summary</p>
          {cart.map(item => (
            <div key={item.menuItem.id} className="flex justify-between font-serif text-ink py-1">
              <span>{item.menuItem.name} &times; {item.quantity}</span>
              <span>${((item.menuItem.price || 0) * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t border-warm mt-3 pt-3 flex justify-between font-serif text-lg text-ink">
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Guest Info */}
      <div className="border border-warm bg-parchment-light p-6 md:p-10 mb-8 space-y-6">
        <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-2">Your Info</p>
        <div className="flex items-baseline gap-4">
          <label className="text-[10px] tracking-[0.2em] uppercase text-ink-muted whitespace-nowrap min-w-[80px]">Name</label>
          <input
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            placeholder="Enter your name"
            required
            className="flex-1 border-0 border-b border-warm bg-transparent py-2 font-script text-lg text-ink italic placeholder:text-stone-dark placeholder:italic outline-none focus:border-ink transition-colors"
          />
        </div>
        <div className="flex items-baseline gap-4">
          <label className="text-[10px] tracking-[0.2em] uppercase text-ink-muted whitespace-nowrap min-w-[80px]">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="email@address.com"
            className="flex-1 border-0 border-b border-warm bg-transparent py-2 font-script text-lg text-ink italic placeholder:text-stone-dark placeholder:italic outline-none focus:border-ink transition-colors"
          />
        </div>
        <div className="flex items-baseline gap-4">
          <label className="text-[10px] tracking-[0.2em] uppercase text-ink-muted whitespace-nowrap min-w-[80px]">Phone</label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="Or provide phone"
            className="flex-1 border-0 border-b border-warm bg-transparent py-2 font-script text-lg text-ink italic placeholder:text-stone-dark placeholder:italic outline-none focus:border-ink transition-colors"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="text-center">
        <button
          onClick={handleSubmit}
          disabled={submitting || cart.length === 0}
          className="border border-forest px-10 py-4 text-xs tracking-[0.2em] uppercase text-forest hover:bg-forest hover:text-cream transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Processing...' : `[ Pay $${total.toFixed(2)} with Venmo ]`}
        </button>
        <p className="text-xs text-ink-muted mt-4">
          You will be redirected to Venmo to complete payment.
        </p>
      </div>
    </div>
  )
}
