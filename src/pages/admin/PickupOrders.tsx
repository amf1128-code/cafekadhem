import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { PickupOrder, Guest, PickupOrderItem, MenuItem } from '../../lib/types'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { formatDate, formatTime } from '../../lib/utils/date'
import { downloadCSV } from '../../lib/utils/csv'

type OrderWithDetails = PickupOrder & {
  guest: Guest
  items: (PickupOrderItem & { menu_item: MenuItem })[]
}

const statusCycle: Record<string, string> = {
  pending: 'confirmed',
  confirmed: 'paid',
  paid: 'picked_up',
  picked_up: 'pending',
}

const statusVariants: Record<string, 'warning' | 'info' | 'success' | 'default'> = {
  pending: 'warning',
  confirmed: 'info',
  paid: 'success',
  picked_up: 'default',
  cancelled: 'default',
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  paid: 'Paid',
  picked_up: 'Picked Up',
  cancelled: 'Cancelled',
}

type FilterType = 'all' | 'active' | 'picked_up'

export function AdminPickupOrders() {
  const { addToast } = useToast()
  const [orders, setOrders] = useState<OrderWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('active')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const { data } = await supabase
      .from('pickup_orders')
      .select('*, guest:guests(*), items:pickup_order_items(*, menu_item:menu_items(*))')
      .order('pickup_date', { ascending: true })
      .order('pickup_time', { ascending: true })

    if (data) setOrders(data as OrderWithDetails[])
    setLoading(false)
  }

  async function toggleStatus(orderId: string, currentStatus: string) {
    const nextStatus = statusCycle[currentStatus] || 'pending'
    const { error } = await supabase
      .from('pickup_orders')
      .update({ status: nextStatus })
      .eq('id', orderId)

    if (error) {
      addToast('Failed to update status', 'error')
    } else {
      setOrders(prev =>
        prev.map(o => (o.id === orderId ? { ...o, status: nextStatus as PickupOrder['status'] } : o))
      )
      addToast(`Status: ${statusLabels[nextStatus] || nextStatus}`)
    }
  }

  async function markPickedUp(orderId: string) {
    const { error } = await supabase
      .from('pickup_orders')
      .update({ status: 'picked_up' })
      .eq('id', orderId)

    if (error) {
      addToast('Failed to update', 'error')
    } else {
      setOrders(prev =>
        prev.map(o => (o.id === orderId ? { ...o, status: 'picked_up' as const } : o))
      )
      addToast('Marked as picked up')
    }
  }

  function orderCost(o: OrderWithDetails): number {
    return o.items.reduce((sum, i) => sum + (i.unit_cost ?? 0) * i.quantity, 0)
  }

  function handleExport() {
    const rows = filteredOrders.map(o => ({
      guest_name: `${o.guest.first_name} ${o.guest.last_name || ''}`.trim(),
      email: o.guest.email || '',
      phone: o.guest.phone || '',
      pickup_date: o.pickup_date,
      pickup_time: o.pickup_time,
      items: o.items.map(i => `${i.menu_item?.name || 'Unknown'} x${i.quantity}`).join('; '),
      total: o.total || 0,
      cost: orderCost(o).toFixed(2),
      margin: ((o.total || 0) - orderCost(o)).toFixed(2),
      status: o.status,
      notes: o.notes || '',
      created: o.created_at,
    }))
    downloadCSV(rows, 'pickup-orders.csv')
    addToast('CSV downloaded')
  }

  const filteredOrders = orders.filter(o => {
    if (filter === 'active') return o.status !== 'picked_up' && o.status !== 'cancelled'
    if (filter === 'picked_up') return o.status === 'picked_up'
    return true
  })

  const pendingCount = orders.filter(o => o.status === 'pending' || o.status === 'confirmed' || o.status === 'paid').length
  const billable = orders.filter(o => o.status !== 'cancelled')
  const totalRevenue = billable.reduce((sum, o) => sum + (o.total || 0), 0)
  const paidRevenue = orders.filter(o => o.status === 'paid' || o.status === 'picked_up').reduce((sum, o) => sum + (o.total || 0), 0)
  const totalCost = billable.reduce((sum, o) => sum + orderCost(o), 0)
  const margin = totalRevenue - totalCost

  if (loading) return <PageLoader />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-forest-dark">Pick-Up Orders</h1>
          <p className="text-sm text-ink/60">{pendingCount} pending tickets</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>Export CSV</Button>
          <Link to="/admin/pickup">
            <Button variant="ghost" size="sm">Config</Button>
          </Link>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white border border-warm rounded-lg p-4 text-center">
          <p className="text-2xl font-serif text-forest-dark">{pendingCount}</p>
          <p className="text-sm text-ink/60">Active Tickets</p>
        </div>
        <div className="bg-white border border-warm rounded-lg p-4 text-center">
          <p className="text-2xl font-serif text-forest-dark">${totalRevenue.toFixed(2)}</p>
          <p className="text-sm text-ink/60">Revenue</p>
        </div>
        <div className="bg-white border border-warm rounded-lg p-4 text-center">
          <p className="text-2xl font-serif text-forest-dark">${paidRevenue.toFixed(2)}</p>
          <p className="text-sm text-ink/60">Paid / Picked Up</p>
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

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {(['active', 'picked_up', 'all'] as FilterType[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              filter === f
                ? 'bg-forest text-cream'
                : 'text-ink/60 hover:bg-warm/50'
            }`}
          >
            {f === 'active' ? 'Active' : f === 'picked_up' ? 'Picked Up' : 'All'}
          </button>
        ))}
      </div>

      {/* Orders Table */}
      {filteredOrders.length === 0 ? (
        <p className="text-ink/60">No orders to show.</p>
      ) : (
        <div className="bg-white border border-warm rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm bg-warm/30">
                <th className="text-left px-4 py-2 font-medium text-ink/70">Guest</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Pickup</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Items</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Total</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Status</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map(order => (
                <tr key={order.id} className="border-b border-warm/50 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{order.guest.first_name} {order.guest.last_name || ''}</p>
                    {order.guest.phone && <p className="text-xs text-ink/50">{order.guest.phone}</p>}
                    {order.notes && <p className="text-xs text-ink/50 italic mt-1">{order.notes}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{formatDate(order.pickup_date)}</p>
                    <p className="text-xs text-ink/60">{formatTime(order.pickup_time)}</p>
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
                        {statusLabels[order.status] || order.status}
                      </Badge>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {order.status !== 'picked_up' && order.status !== 'cancelled' && (
                      <button
                        onClick={() => markPickedUp(order.id)}
                        className="text-xs text-forest hover:text-forest-dark font-medium transition-colors"
                      >
                        Mark Picked Up
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
