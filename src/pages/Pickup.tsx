import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { PickupConfig, PickupSlot, MenuItem, AdminSettings, CartItem, MenuItemAvailability } from '../lib/types'
import { getGuestToken, setGuestToken } from '../lib/utils/guest-token'
import { dispatchMergeVerification, type PendingMerge } from '../lib/identity/handlePendingMerge'
import { normalizePhone } from '../lib/utils/phone'
import { formatTime } from '../lib/utils/date'
import { getPaymentProvider } from '../lib/payment'
import { sendNotification } from '../lib/notifications'
import { PageLoader } from '../components/ui/LoadingSpinner'
import { useToast } from '../components/ui/Toast'
import { usePageTheme } from '../lib/theme/themes'

export function Pickup() {
  const { addToast } = useToast()
  const navigate = useNavigate()
  // Pickup isn't tied to an event — keep it on the editorial archival theme
  // regardless of which event-driven theme the home page just rendered in.
  usePageTheme('theme1')
  const [config, setConfig] = useState<PickupConfig | null>(null)
  const [slots, setSlots] = useState<PickupSlot[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [availability, setAvailability] = useState<Record<string, { max: number; sold: number }>>({})
  const [cart, setCart] = useState<CartItem[]>([])
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Guest info
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')

  // Pickup slot selection
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')

  useEffect(() => {
    loadData()
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

    // Pre-fill guest info
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

  // Build available dates from slots (next 14 days)
  const availableDates = useMemo(() => {
    const dates: { date: string; label: string; dayOfWeek: number }[] = []
    const today = new Date()
    // Start from tomorrow so orders are always future
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

  // Time slots for selected date
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
        return prev.map(c => c.menuItem.id === item.id ? { ...c, quantity: newQty } : c)
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
    if (!firstName.trim()) {
      addToast('Please provide your name.', 'error')
      return
    }
    const smsEnabled = !!settings?.sms_enabled
    if (smsEnabled ? (!email.trim() && !phone.trim()) : !email.trim()) {
      addToast(
        smsEnabled ? 'Please provide an email or phone.' : 'Please provide an email address.',
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
      // Single round-trip upsert: dedups by email/phone server-side or
      // updates by id when we already have a localStorage token. Pickup
      // only collects first/email/phone, so we send only those three —
      // last_name / instagram / notification_preference stay whatever
      // the guest set on a prior form. Phone is omitted entirely while
      // SMS is disabled so a returning guest's stored number is left
      // intact rather than being cleared by the missing field.
      const fields: Record<string, unknown> = {
        first_name: firstName.trim(),
        email: email.trim() || null,
      }
      if (smsEnabled) {
        fields.phone = phone.trim() ? normalizePhone(phone.trim()) : null
      }
      const { data: guest, error: guestErr } = await supabase.rpc('upsert_guest', {
        p_fields: fields,
        p_guest_id: getGuestToken(),
      })
      if (guestErr) throw guestErr
      if (!guest) throw new Error('Failed to create guest')
      const guestId = guest.id as string
      setGuestToken(guestId)

      // Case B identity collision (USER_FLOWS_SPEC.md §3.4).
      const pendingMerge = (guest as { pending_merge?: PendingMerge }).pending_merge
      if (pendingMerge?.verification_token) {
        void dispatchMergeVerification(pendingMerge)
      }

      const venmoNote = `${firstName.trim()} - Pickup ${selectedDate}`

      // Place the order through the safe RPC so per-item caps are checked
      // atomically against current sold counts.
      const { data: order, error: orderErr } = await supabase.rpc('safe_create_pickup_order', {
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
      if (!settings?.venmo_handle) throw new Error('Venmo handle not configured')
      const provider = getPaymentProvider('venmo')
      const paymentGuest = { id: guestId, first_name: firstName.trim() } as any
      const fakeEvent = { title: `Pickup ${selectedDate}` } as any
      const paymentLink = provider.generatePaymentLink(
        { ...order, total } as any,
        paymentGuest,
        fakeEvent,
        settings.venmo_handle
      )

      window.open(paymentLink.url, '_blank')

      // Fire-and-forget confirmation: emails/texts the per-order pickup
      // ticket URL (with QR) plus a magic-link to MyTickets for history.
      sendNotification({
        guestId,
        type: 'pickup_order_confirmation',
        data: {
          pickup_when: `${new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${formatTime(selectedTime)}`,
          pickup_token: order.pickup_token,
        },
      })

      addToast('Order submitted!')
      // Drop the guest on their pickup ticket page — same page the email
      // link points to, so they can show the QR at handoff.
      navigate(`/pickup/${order.pickup_token}`)
      return
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to submit order', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <PageLoader />

  if (!config || !config.menu_id) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="font-serif text-xl text-ink-muted italic">
          Pick-up orders are not available right now.
        </p>
        <p className="text-sm text-ink-muted mt-3">Check back soon.</p>
        <Link
          to="/"
          className="inline-block mt-6 border border-warm px-8 py-3 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors"
        >
          [ Back to Home ]
        </Link>
      </div>
    )
  }

  const categories = Array.from(new Set(menuItems.map(i => i.category || 'Other')))

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="border border-warm bg-parchment-light p-6 md:p-10 mb-8">
        <p className="text-xs tracking-[0.25em] uppercase text-ink-muted mb-2">Pick-Up Order</p>
        <h1 className="font-serif text-3xl text-ink italic mb-1">Cafe Kadhem</h1>
        <p className="font-serif text-sm text-ink-muted italic">Select your items, choose a pickup day & time, and pay with Venmo.</p>
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

      {/* Pickup Date & Time */}
      <div className="border border-warm bg-parchment-light p-6 md:p-10 mb-8">
        <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-4">Pick-Up Date & Time</p>

        {availableDates.length === 0 ? (
          <p className="font-serif text-sm text-ink-muted italic">No pickup times available right now.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-6">
              {availableDates.map(d => (
                <button
                  key={d.date}
                  onClick={() => { setSelectedDate(d.date); setSelectedTime('') }}
                  className={`px-4 py-2 border text-sm transition-colors ${
                    selectedDate === d.date
                      ? 'border-forest bg-forest text-cream'
                      : 'border-warm text-ink-muted hover:border-ink hover:text-ink'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {selectedDate && availableTimes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {availableTimes.map(slot => (
                  <button
                    key={slot.id}
                    onClick={() => setSelectedTime(slot.start_time)}
                    className={`px-4 py-2 border text-sm transition-colors ${
                      selectedTime === slot.start_time
                        ? 'border-forest bg-forest text-cream'
                        : 'border-warm text-ink-muted hover:border-ink hover:text-ink'
                    }`}
                  >
                    {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

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
        {settings?.sms_enabled && (
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
        )}
        <div className="flex items-baseline gap-4">
          <label className="text-[10px] tracking-[0.2em] uppercase text-ink-muted whitespace-nowrap min-w-[80px]">Notes</label>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Any special requests (optional)"
            className="flex-1 border-0 border-b border-warm bg-transparent py-2 font-script text-lg text-ink italic placeholder:text-stone-dark placeholder:italic outline-none focus:border-ink transition-colors"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="text-center">
        <button
          onClick={handleSubmit}
          disabled={submitting || cart.length === 0 || !selectedDate || !selectedTime}
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
