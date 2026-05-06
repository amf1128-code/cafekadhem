import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { MenuItem, PickupOrder, PickupOrderItem } from '../lib/types'
import { formatDate, formatTime } from '../lib/utils/date'
import { QRCode } from '../components/tickets/QRCode'
import { CinemaPageLoader } from '../components/cinema/primitives'

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

  if (loading) return <CinemaPageLoader />

  if (notFound || !order) {
    return (
      <section className="ck-page" style={{ textAlign: 'center', borderBottom: 'none' }}>
        <div className="ck-narrow">
          <div className="ck-eyebrow">✦ Hmm</div>
          <h1 className="ck-h1" style={{ marginTop: 12 }}>
            ORDER NOT
            <br />
            <span className="ck-italic">found</span>
          </h1>
          <p className="ck-italic" style={{ fontSize: 18, marginTop: 18 }}>
            The link may be expired or mistyped. Check the email/text we
            sent for the latest one.
          </p>
        </div>
      </section>
    )
  }

  const url = `${window.location.origin}/pickup/${order.pickup_token}`
  const pickedUp = order.status === 'picked_up'
  const cancelled = order.status === 'cancelled'

  return (
    <section className="ck-page" style={{ borderBottom: 'none' }}>
      <div className="ck-narrow">
        <div className="ck-eyebrow">✦ Pick-up order</div>
        <div
          className="ck-section-head-row"
          style={{ marginTop: 6, alignItems: 'baseline' }}
        >
          <h1 className="ck-h1">PICK-UP.</h1>
          <span
            style={{
              fontFamily: 'var(--ck-arabic-display)',
              fontSize: 'clamp(40px, 5vw, 60px)',
              direction: 'rtl',
              color: 'var(--ck-cobalt)',
              lineHeight: 0.9,
            }}
          >
            استلام
          </span>
        </div>

        <div
          className="ck-card"
          style={{
            marginTop: 28,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: '1fr',
          }}
        >
          {/* QR code panel */}
          <div
            style={{
              background: 'var(--ck-cream)',
              padding: 32,
              textAlign: 'center',
              borderBottom: '2px dashed var(--ck-ink)',
              opacity: pickedUp || cancelled ? 0.55 : 1,
            }}
          >
            <div
              style={{
                display: 'inline-block',
                border: '2px solid var(--ck-ink)',
                background: 'var(--ck-cream)',
                padding: 12,
              }}
            >
              <QRCode value={url} size={240} />
            </div>
            <div className="ck-mono" style={{ marginTop: 14, opacity: 0.7 }}>
              {pickedUp
                ? 'Already picked up'
                : cancelled
                  ? 'Cancelled'
                  : 'Show this at pickup'}
            </div>
          </div>

          {/* Order details */}
          <div style={{ padding: 24 }}>
            <Row label="Pick-up" value={`${formatDate(order.pickup_date)} · ${formatTime(order.pickup_time)}`} />
            <Row label="Status" value={STATUS_LABELS[order.status] || order.status} />
            {order.total != null && (
              <Row label="Total" value={`$${order.total.toFixed(2)}`} />
            )}

            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: '1px dashed var(--ck-ink)',
              }}
            >
              <div className="ck-label" style={{ marginBottom: 6 }}>
                Items
              </div>
              {order.items.map(i => (
                <div
                  key={i.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                    fontFamily: 'var(--ck-serif)',
                    fontWeight: 700,
                    fontSize: 16,
                    borderBottom: '1px dashed rgba(13,13,15,0.15)',
                  }}
                >
                  <span>
                    {i.menu_item?.name || 'Unknown'}
                    <span style={{ opacity: 0.55, marginLeft: 8 }}>× {i.quantity}</span>
                  </span>
                  {i.unit_price != null && (
                    <span>${(i.unit_price * i.quantity).toFixed(2)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <p
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            textAlign: 'center',
            opacity: 0.6,
            marginTop: 18,
          }}
        >
          Save this page or screenshot the QR — ready at pickup.
        </p>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr',
        gap: 12,
        padding: '8px 0',
        borderBottom: '1px solid rgba(13,13,15,0.1)',
        alignItems: 'baseline',
      }}
    >
      <span className="ck-label">{label}</span>
      <span
        style={{
          fontFamily: 'var(--ck-serif)',
          fontWeight: 700,
          fontSize: 17,
          lineHeight: 1.3,
        }}
      >
        {value}
      </span>
    </div>
  )
}
