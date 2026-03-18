import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Event, MenuItem, AdminSettings, CartItem } from '../lib/types'
import { getGuestToken, setGuestToken } from '../lib/utils/guest-token'
import { normalizePhone } from '../lib/utils/phone'
import { getPaymentProvider } from '../lib/payment'
import { sendNotification } from '../lib/notifications'
import { PageLoader } from '../components/ui/LoadingSpinner'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'

export function Order() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [event, setEvent] = useState<Event | null>(null)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Guest info
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

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
        const { data: items } = await supabase
          .from('menu_items')
          .select('*')
          .eq('menu_id', eventResult.data.menu_id)
          .eq('is_available', true)
          .order('sort_order')
        if (items) setMenuItems(items)
      }
    }

    if (settingsResult.data) setSettings(settingsResult.data)

    // Pre-fill guest info if returning
    const guestToken = getGuestToken()
    if (guestToken) {
      const { data: guest } = await supabase
        .from('guests')
        .select('*')
        .eq('id', guestToken)
        .single()
      if (guest) {
        setFirstName(guest.first_name)
        if (guest.email) setEmail(guest.email)
        if (guest.phone) setPhone(guest.phone)
      }
    }

    setLoading(false)
  }

  function updateCart(item: MenuItem, delta: number) {
    setCart(prev => {
      const existing = prev.find(c => c.menuItem.id === item.id)
      if (existing) {
        const newQty = existing.quantity + delta
        if (newQty <= 0) {
          return prev.filter(c => c.menuItem.id !== item.id)
        }
        return prev.map(c =>
          c.menuItem.id === item.id ? { ...c, quantity: newQty } : c
        )
      }
      if (delta > 0) {
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
      // Upsert guest
      let guestId = getGuestToken()
      const guestData = {
        first_name: firstName.trim(),
        email: email.trim() || null,
        phone: phone.trim() ? normalizePhone(phone.trim()) : null,
      }

      if (guestId) {
        await supabase.from('guests').update(guestData).eq('id', guestId)
      } else {
        // Check for existing by email/phone
        let existingQuery = supabase.from('guests').select('id')
        if (guestData.email) {
          existingQuery = existingQuery.eq('email', guestData.email)
        } else if (guestData.phone) {
          existingQuery = existingQuery.eq('phone', guestData.phone)
        }
        const { data: existing } = await existingQuery.limit(1).single()

        if (existing) {
          guestId = existing.id
          await supabase.from('guests').update(guestData).eq('id', guestId)
        } else {
          const { data: newGuest } = await supabase
            .from('guests')
            .insert(guestData)
            .select('id')
            .single()
          if (newGuest) guestId = newGuest.id
        }
      }

      if (!guestId) throw new Error('Failed to create guest')
      setGuestToken(guestId)

      const venmoNote = `${firstName.trim()} - ${event!.title}`

      // Create order
      const { data: order } = await supabase
        .from('orders')
        .insert({
          event_id: id!,
          guest_id: guestId,
          total,
          venmo_note: venmoNote,
          status: 'pending',
          payment_method: 'venmo',
        })
        .select('*')
        .single()

      if (!order) throw new Error('Failed to create order')

      // Create order items
      await supabase.from('order_items').insert(
        cart.map(item => ({
          order_id: order.id,
          menu_item_id: item.menuItem.id,
          quantity: item.quantity,
          unit_price: item.menuItem.price,
        }))
      )

      // Generate payment link
      const provider = getPaymentProvider('venmo')
      const guest = { id: guestId, first_name: firstName.trim() } as any
      const paymentLink = provider.generatePaymentLink(order, guest, event!, settings!.venmo_handle)

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
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-ink/60">Event not found.</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <h1 className="font-serif text-3xl text-forest-dark mb-4">Thanks!</h1>
        <p className="text-ink/70 mb-2">Your order has been submitted.</p>
        <p className="text-ink/60 text-sm mb-6">
          Payment status will be confirmed by the host. After paying on Venmo, your host will confirm your payment.
        </p>
        <Link to={`/events/${event.id}`}>
          <Button variant="outline">Back to Event</Button>
        </Link>
      </div>
    )
  }

  // Group items by category
  const categories = Array.from(new Set(menuItems.map(i => i.category || 'Other')))

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="font-serif text-2xl text-forest-dark mb-1">Pre-Order</h1>
      <p className="text-ink/60 text-sm mb-6">{event.title}</p>

      {/* Menu Items */}
      <div className="space-y-6 mb-8">
        {categories.map(cat => (
          <div key={cat}>
            <h3 className="font-serif text-lg text-forest-dark mb-3">{cat}</h3>
            <div className="space-y-3">
              {menuItems
                .filter(i => (i.category || 'Other') === cat)
                .map(item => {
                  const inCart = cart.find(c => c.menuItem.id === item.id)
                  return (
                    <div key={item.id} className="bg-white border border-warm rounded-lg p-4 flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-ink">{item.name}</p>
                        {item.description && (
                          <p className="text-sm text-ink/60 mt-0.5">{item.description}</p>
                        )}
                        {item.price != null && (
                          <p className="text-sm text-forest font-medium mt-1">${item.price.toFixed(2)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateCart(item, -1)}
                          className="w-8 h-8 rounded-full border border-warm text-ink/60 hover:bg-warm/50 flex items-center justify-center"
                          disabled={!inCart}
                        >
                          -
                        </button>
                        <span className="w-6 text-center text-sm font-medium">
                          {inCart?.quantity || 0}
                        </span>
                        <button
                          onClick={() => updateCart(item, 1)}
                          className="w-8 h-8 rounded-full border border-forest text-forest hover:bg-forest hover:text-cream flex items-center justify-center"
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

      {/* Order Summary */}
      {cart.length > 0 && (
        <div className="bg-white border border-warm rounded-xl p-5 mb-6">
          <h3 className="font-serif text-lg text-forest-dark mb-3">Order Summary</h3>
          {cart.map(item => (
            <div key={item.menuItem.id} className="flex justify-between text-sm py-1">
              <span>{item.menuItem.name} x{item.quantity}</span>
              <span>${((item.menuItem.price || 0) * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t border-warm mt-2 pt-2 flex justify-between font-medium">
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Guest Info */}
      <div className="bg-white border border-warm rounded-xl p-5 mb-6 space-y-3">
        <h3 className="font-serif text-lg text-forest-dark">Your Info</h3>
        <Input
          label="First Name"
          value={firstName}
          onChange={e => setFirstName(e.target.value)}
          required
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Or provide phone below"
        />
        <Input
          label="Phone"
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="Or provide email above"
        />
      </div>

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        loading={submitting}
        disabled={cart.length === 0}
        size="lg"
        className="w-full"
      >
        Pay ${total.toFixed(2)} with Venmo
      </Button>

      <p className="text-xs text-ink/50 text-center mt-3">
        You will be redirected to Venmo to complete payment.
      </p>
    </div>
  )
}
