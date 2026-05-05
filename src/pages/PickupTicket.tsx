import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { PickupOrder, PickupOrderItem, MenuItem } from '../lib/types'
import { formatDate, formatTime } from '../lib/utils/date'
import { PageLoader } from '../components/ui/LoadingSpinner'
import { QRCode } from '../components/tickets/QRCode'
import { usePageTheme } from '../lib/theme/themes'

type OrderRow = PickupOrder & {
  items: (PickupOrderItem & { menu_item: MenuItem | null })[]
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending payment',
  confirmed: 'Confirmed',
  paid: 'Paid',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
}

export function PickupTicket() {
  const { token } = useParams<{ token: string }>()
  // Pickup isn't tied to an event theme; keep the editorial archival look.
  usePageTheme('theme1')
  const [order, setOrder] = useState<OrderRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setNotFound(true)
      setLoading(false)
      return
    }
    // Public lookup goes through a SECURITY DEFINER RPC instead of a
    // direct anon SELECT on pickup_orders, so the only way to reach a
    // row is via its pickup_token. The RPC also strips the admin-only
    // unit_cost field from the embedded items / menu_item rows.
    supabase
      .rpc('get_pickup_order', { p_token: token })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setNotFound(true)
        } else {
          setOrder(data as OrderRow)
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  if (loading) return <PageLoader />

  if (notFound || !order) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <p className="font-serif text-xl text-ink-muted italic">Order not found.</p>
        <p className="text-sm text-ink-muted mt-3">
          The link may be expired or mistyped. Check the email/text we sent for the latest one.
        </p>
      </div>
    )
  }

  const url = `${window.location.origin}/pickup/${order.pickup_token}`
  const pickedUp = order.status === 'picked_up'
  const cancelled = order.status === 'cancelled'

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="border border-warm bg-parchment-light p-6 md:p-10">
        <p className="text-xs tracking-[0.25em] uppercase text-ink-muted mb-2 text-center">
          Cafe Kadhem
        </p>
        <h1 className="font-serif text-2xl md:text-3xl text-forest-dark italic text-center mb-6">
          Pick-Up Order
        </h1>

        <div className="border-t border-warm mb-6" />

        <div className="grid grid-cols-2 gap-4 mb-6 text-center">
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1">Pick-up</p>
            <p className="font-serif text-lg text-ink">{formatDate(order.pickup_date)}</p>
            <p className="text-sm text-ink-muted">{formatTime(order.pickup_time)}</p>
          </div>
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1">Status</p>
            <p className="font-serif text-lg text-ink">{STATUS_LABELS[order.status] || order.status}</p>
            {order.total != null && (
              <p className="text-sm text-ink-muted">${order.total.toFixed(2)}</p>
            )}
          </div>
        </div>

        <div className="border-t border-warm mb-6" />

        <div className="mb-6">
          <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-3 text-center">Items</p>
          <div className="space-y-1">
            {order.items.map(i => (
              <div key={i.id} className="flex justify-between font-serif text-ink">
                <span>{i.menu_item?.name || 'Unknown'} &times; {i.quantity}</span>
                {i.unit_price != null && (
                  <span>${(i.unit_price * i.quantity).toFixed(2)}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-warm mb-6" />

        <div className="flex flex-col items-center">
          {pickedUp ? (
            <div className="text-center mb-4">
              <p className="text-xs tracking-[0.2em] uppercase text-forest mb-1">Picked Up</p>
              <p className="text-sm text-ink-muted italic">Thanks for stopping by.</p>
            </div>
          ) : cancelled ? (
            <div className="text-center mb-4">
              <p className="text-xs tracking-[0.2em] uppercase text-red-700 mb-1">Cancelled</p>
              <p className="text-sm text-ink-muted italic">
                This order has been cancelled. Reach out to your host with any questions.
              </p>
            </div>
          ) : (
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-4">
              Show this at pickup
            </p>
          )}
          <div className={`p-4 bg-cream border border-warm ${pickedUp || cancelled ? 'opacity-50' : ''}`}>
            <QRCode value={url} size={240} />
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-ink-muted mt-6">
        Save this page or screenshot the QR so it's ready when you pick up.
      </p>
    </div>
  )
}
