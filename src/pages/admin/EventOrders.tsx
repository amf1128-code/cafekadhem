import { useState, useEffect, useMemo } from 'react'
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

const statusVariants: Record<Order['status'], 'warning' | 'success' | 'default'> = {
  pending: 'warning',
  paid: 'success',
  cancelled: 'default',
}

export function AdminEventOrders() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [event, setEvent] = useState<Event | null>(null)
  const [orders, setOrders] = useState<OrderWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)

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

  function markPaid(orderId: string) {
    setStatus(orderId, 'paid', 'Marked paid')
  }

  function markPending(orderId: string) {
    setStatus(orderId, 'pending', 'Reverted to pending')
  }

  function cancelOrder(orderId: string) {
    if (!confirm('Cancel this order? It will be excluded from totals and free up any limited inventory.')) return
    // Cancelling drops the row from the selection so it doesn't carry into a bulk action.
    setSelectedIds(prev => {
      if (!prev.has(orderId)) return prev
      const next = new Set(prev)
      next.delete(orderId)
      return next
    })
    setStatus(orderId, 'cancelled', 'Order cancelled')
  }

  function restoreOrder(orderId: string) {
    setStatus(orderId, 'pending', 'Order restored')
  }

  // Pending orders are the only legal target for "Mark as paid" — paid rows
  // are already there, cancelled rows need an explicit Restore first.
  const pendingOrders = useMemo(() => orders.filter(o => o.status === 'pending'), [orders])
  const allPendingSelected =
    pendingOrders.length > 0 && pendingOrders.every(o => selectedIds.has(o.id))
  const selectedCount = selectedIds.size

  function toggleSelectAllPending() {
    setSelectedIds(prev => {
      if (allPendingSelected) {
        // Drop only the pending ids; keep any other ids the user manually selected.
        const next = new Set(prev)
        for (const o of pendingOrders) next.delete(o.id)
        return next
      }
      const next = new Set(prev)
      for (const o of pendingOrders) next.add(o.id)
      return next
    })
  }

  function toggleRow(orderId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function bulkMarkPaid() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    // Defensive: only flip pending rows. The toolbar's count already excludes
    // anything else, but the user could have toggled selection right before.
    const eligible = orders.filter(o => ids.includes(o.id) && o.status === 'pending')
    if (eligible.length === 0) {
      addToast('Nothing to mark — selected orders are already paid or cancelled.', 'error')
      return
    }
    if (!confirm(`Mark ${eligible.length} order${eligible.length === 1 ? '' : 's'} as paid?`)) return

    setBulkUpdating(true)
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'paid' })
        .in('id', eligible.map(o => o.id))
      if (error) throw error
      const eligibleIds = new Set(eligible.map(o => o.id))
      setOrders(prev =>
        prev.map(o => (eligibleIds.has(o.id) ? { ...o, status: 'paid' } : o))
      )
      setSelectedIds(new Set())
      addToast(`Marked ${eligible.length} as paid`)
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Bulk update failed', 'error')
    } finally {
      setBulkUpdating(false)
    }
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

      {/* Bulk action toolbar — shows whenever any row is selected. */}
      {selectedCount > 0 && (
        <div className="sticky top-0 z-10 bg-forest text-white rounded-lg px-4 py-3 mb-3 flex items-center justify-between shadow-md">
          <span className="text-sm font-medium">
            {selectedCount} selected
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              loading={bulkUpdating}
              onClick={bulkMarkPaid}
            >
              Mark as paid →
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection} disabled={bulkUpdating}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Orders Table */}
      {orders.length === 0 ? (
        <p className="text-ink/60">No orders yet.</p>
      ) : (
        <div className="bg-white border border-warm rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm bg-warm/30">
                <th className="px-4 py-2 w-10">
                  {pendingOrders.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Select all pending"
                      title={
                        allPendingSelected
                          ? 'Clear pending selection'
                          : `Select all ${pendingOrders.length} pending`
                      }
                      checked={allPendingSelected}
                      onChange={toggleSelectAllPending}
                      className="cursor-pointer accent-forest"
                    />
                  )}
                </th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Guest</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Items</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Total</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Status</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Date</th>
                <th className="text-right px-4 py-2 font-medium text-ink/70">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => {
                const checkable = order.status === 'pending'
                const checked = selectedIds.has(order.id)
                return (
                  <tr
                    key={order.id}
                    className={`border-b border-warm/50 last:border-0 ${checked ? 'bg-warm/20' : ''}`}
                  >
                    <td className="px-4 py-3 text-center">
                      {checkable ? (
                        <input
                          type="checkbox"
                          aria-label={`Select order from ${order.guest.first_name}`}
                          checked={checked}
                          onChange={() => toggleRow(order.id)}
                          className="cursor-pointer accent-forest"
                        />
                      ) : null}
                    </td>
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
                      <Badge variant={statusVariants[order.status]}>
                        {order.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-ink/60">
                      {new Date(order.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3 justify-end items-center">
                        {order.status === 'pending' && (
                          <button
                            onClick={() => markPaid(order.id)}
                            className="text-xs font-medium text-forest hover:text-forest-dark transition-colors"
                          >
                            Mark paid →
                          </button>
                        )}
                        {order.status === 'paid' && (
                          <button
                            onClick={() => markPending(order.id)}
                            className="text-xs font-medium text-ink/60 hover:text-ink transition-colors"
                            title="Revert to pending"
                          >
                            Undo
                          </button>
                        )}
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
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
