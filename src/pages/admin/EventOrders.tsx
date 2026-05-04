import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Order, Guest, OrderItem, MenuItem, Event } from '../../lib/types'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { downloadCSV } from '../../lib/utils/csv'

type OrderWithDetails = Order & {
  guest: Guest
  items: (OrderItem & { menu_item: MenuItem })[]
}

const statusCycle: Record<string, string> = {
  pending: 'confirmed',
  confirmed: 'paid',
  paid: 'pending',
}

const statusVariants: Record<string, 'warning' | 'info' | 'success' | 'default'> = {
  pending: 'warning',
  confirmed: 'info',
  paid: 'success',
  cancelled: 'default',
}

export function AdminEventOrders() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [event, setEvent] = useState<Event | null>(null)
  const [orders, setOrders] = useState<OrderWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) loadData()
  }, [id])

  async function loadData() {
    const [eventResult, ordersResult] = await Promise.all([
      supabase.from('events').select('*').eq('id', id!).single(),
      supabase
        .from('orders')
        .select('*, guest:guests(*), items:order_items(*, menu_item:menu_items(*))')
        .eq('event_id', id!)
        .order('created_at', { ascending: false }),
    ])

    if (eventResult.data) setEvent(eventResult.data)
    if (ordersResult.data) setOrders(ordersResult.data as OrderWithDetails[])
    setLoading(false)
  }

  async function toggleStatus(orderId: string, currentStatus: string) {
    // Don't let the badge cycle out of cancelled — that's what Restore is for.
    if (currentStatus === 'cancelled') return
    const nextStatus = statusCycle[currentStatus] || 'pending'
    const { error } = await supabase
      .from('orders')
      .update({ status: nextStatus })
      .eq('id', orderId)

    if (error) {
      addToast('Failed to update status', 'error')
    } else {
      setOrders(prev =>
        prev.map(o => (o.id === orderId ? { ...o, status: nextStatus as Order['status'] } : o))
      )
      addToast(`Status: ${nextStatus}`)
    }
  }

  async function setStatus(orderId: string, nextStatus: Order['status'], successMsg: string) {
    const { error } = await supabase
      .from('orders')
      .update({ status: nextStatus })
      .eq('id', orderId)
    if (error) {
      addToast('Failed to update status', 'error')
      return
    }
    setOrders(prev =>
      prev.map(o => (o.id === orderId ? { ...o, status: nextStatus } : o))
    )
    addToast(successMsg)
  }

  function cancelOrder(orderId: string) {
    if (!confirm('Cancel this order? It will be excluded from totals and free up any limited inventory.')) return
    setStatus(orderId, 'cancelled', 'Order cancelled')
  }

  function restoreOrder(orderId: string) {
    setStatus(orderId, 'pending', 'Order restored')
  }

  function orderCost(o: OrderWithDetails): number {
    return o.items.reduce((sum, i) => sum + (i.unit_cost ?? 0) * i.quantity, 0)
  }

  function handleExport() {
    const rows = orders.map(o => ({
      guest_name: `${o.guest.first_name} ${o.guest.last_name || ''}`.trim(),
      email: o.guest.email || '',
      phone: o.guest.phone || '',
      items: o.items.map(i => `${i.menu_item?.name || 'Unknown'} x${i.quantity}`).join('; '),
      total: o.total || 0,
      cost: orderCost(o).toFixed(2),
      margin: ((o.total || 0) - orderCost(o)).toFixed(2),
      status: o.status,
      created: o.created_at,
    }))
    downloadCSV(rows, `${event?.title || 'orders'}-orders.csv`)
    addToast('CSV downloaded')
  }

  if (loading) return <PageLoader />

  if (!event) {
    return <p className="text-ink/60">Event not found.</p>
  }

  const billable = orders.filter(o => o.status !== 'cancelled')
  const totalRevenue = billable.reduce((sum, o) => sum + (o.total || 0), 0)
  const paidRevenue = orders.filter(o => o.status === 'paid').reduce((sum, o) => sum + (o.total || 0), 0)
  const totalCost = billable.reduce((sum, o) => sum + orderCost(o), 0)
  const margin = totalRevenue - totalCost

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-forest-dark">{event.title} - Orders</h1>
          <p className="text-sm text-ink/60">{orders.length} orders</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>Export CSV</Button>
          <Link to={`/admin/events/${id}/edit`}>
            <Button variant="ghost" size="sm">Edit Event</Button>
          </Link>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white border border-warm rounded-lg p-4 text-center">
          <p className="text-2xl font-serif text-forest-dark">{orders.length}</p>
          <p className="text-sm text-ink/60">Total Orders</p>
        </div>
        <div className="bg-white border border-warm rounded-lg p-4 text-center">
          <p className="text-2xl font-serif text-forest-dark">${totalRevenue.toFixed(2)}</p>
          <p className="text-sm text-ink/60">Revenue</p>
        </div>
        <div className="bg-white border border-warm rounded-lg p-4 text-center">
          <p className="text-2xl font-serif text-forest-dark">${paidRevenue.toFixed(2)}</p>
          <p className="text-sm text-ink/60">Paid</p>
        </div>
        <div className="bg-white border border-warm rounded-lg p-4 text-center">
          <p className="text-2xl font-serif text-forest-dark">${totalCost.toFixed(2)}</p>
          <p className="text-sm text-ink/60">Cost</p>
        </div>
        <div className="bg-white border border-warm rounded-lg p-4 text-center">
          <p className="text-2xl font-serif text-forest-dark">${margin.toFixed(2)}</p>
          <p className="text-sm text-ink/60">Margin</p>
        </div>
      </div>

      {/* Orders Table */}
      {orders.length === 0 ? (
        <p className="text-ink/60">No orders yet.</p>
      ) : (
        <div className="bg-white border border-warm rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm bg-warm/30">
                <th className="text-left px-4 py-2 font-medium text-ink/70">Guest</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Items</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Total</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Status</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Date</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => (
                <tr key={order.id} className="border-b border-warm/50 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{order.guest.first_name} {order.guest.last_name || ''}</p>
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    {order.items.map(i => (
                      <span key={i.id} className="block">
                        {i.menu_item?.name || 'Unknown'} x{i.quantity}
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-3">${(order.total || 0).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleStatus(order.id, order.status)}>
                      <Badge variant={statusVariants[order.status]}>
                        {order.status}
                      </Badge>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-ink/60">
                    {new Date(order.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {order.status === 'cancelled' ? (
                      <button
                        onClick={() => restoreOrder(order.id)}
                        className="text-xs text-forest hover:text-forest-dark font-medium transition-colors"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        onClick={() => cancelOrder(order.id)}
                        className="text-xs text-red-600 hover:text-red-800 font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
