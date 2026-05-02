import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Event, RSVP, Guest } from '../../lib/types'
import { formatDate, formatTime } from '../../lib/utils/date'
import { formatPhone } from '../../lib/utils/phone'
import { sendNotification } from '../../lib/notifications'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'

type TicketRow = RSVP & { guest: Guest }

type FilterTab = 'pending' | 'unpaid' | 'paid' | 'all'

const paymentVariant: Record<string, 'warning' | 'info' | 'success' | 'default'> = {
  unpaid: 'default',
  pending: 'warning',
  paid: 'success',
  refunded: 'default',
}

export function AdminEventTickets() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [event, setEvent] = useState<Event | null>(null)
  const [rows, setRows] = useState<TicketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterTab>('pending')

  useEffect(() => {
    if (id) loadData()
  }, [id])

  async function loadData() {
    const [eventResult, rsvpResult] = await Promise.all([
      supabase.from('events').select('*').eq('id', id!).single(),
      supabase
        .from('rsvps')
        .select('*, guest:guests(*)')
        .eq('event_id', id!)
        .eq('status', 'yes')
        .order('created_at', { ascending: true }),
    ])

    if (eventResult.data) setEvent(eventResult.data)
    if (rsvpResult.data) setRows(rsvpResult.data as TicketRow[])
    setLoading(false)
  }

  async function handleMarkPaid(row: TicketRow) {
    setBusy(row.id)
    try {
      const { data, error } = await supabase.rpc('mark_rsvp_paid', { p_rsvp_id: row.id })
      if (error) throw error
      const updated = data as RSVP
      addToast('Marked paid — issuing ticket')

      sendNotification({
        guestId: row.guest_id,
        eventId: id!,
        type: 'ticket_issued',
        data: { ticket_token: updated.ticket_token! },
      })

      await loadData()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to mark paid', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function handleMarkUnpaid(row: TicketRow) {
    if (!confirm('Mark this ticket as unpaid? The guest will keep their token but it will no longer be valid for entry.')) return
    setBusy(row.id)
    try {
      const { error } = await supabase.rpc('mark_rsvp_unpaid', { p_rsvp_id: row.id })
      if (error) throw error
      addToast('Reverted to unpaid')
      await loadData()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function handleResend(row: TicketRow) {
    if (!row.ticket_token) return
    setBusy(row.id)
    try {
      await sendNotification({
        guestId: row.guest_id,
        eventId: id!,
        type: 'ticket_issued',
        data: { ticket_token: row.ticket_token },
      })
      addToast('Ticket re-sent')
    } finally {
      setBusy(null)
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter(r => r.payment_status === filter)
  }, [rows, filter])

  const counts = useMemo(() => {
    return {
      unpaid: rows.filter(r => r.payment_status === 'unpaid').length,
      pending: rows.filter(r => r.payment_status === 'pending').length,
      paid: rows.filter(r => r.payment_status === 'paid').length,
      all: rows.length,
    }
  }, [rows])

  if (loading) return <PageLoader />
  if (!event) return <p className="text-ink/60">Event not found.</p>

  if (!event.ticketing_enabled) {
    return (
      <div className="bg-white border border-warm rounded-lg p-8 text-center">
        <h1 className="font-serif text-xl text-forest-dark mb-2">Ticketing not enabled</h1>
        <p className="text-ink/60 mb-4">
          Turn on ticketing for this event in the editor to manage payments here.
        </p>
        <Link to={`/admin/events/${id}/edit`}>
          <Button variant="outline">Edit Event</Button>
        </Link>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-forest-dark">{event.title} - Tickets</h1>
          <p className="text-sm text-ink/60">
            {formatDate(event.date)} at {formatTime(event.start_time)} · ${event.ticket_price?.toFixed(2) || '0.00'} per ticket
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/admin/events/${id}/checkin`}>
            <Button variant="outline" size="sm">Door / Check-in</Button>
          </Link>
          <Link to={`/admin/events/${id}/edit`}>
            <Button variant="ghost" size="sm">Edit Event</Button>
          </Link>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['pending', 'unpaid', 'paid', 'all'] as FilterTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
              filter === tab
                ? 'bg-forest text-cream border-forest'
                : 'bg-white border-warm text-ink/70 hover:border-forest'
            }`}
          >
            {tab[0].toUpperCase() + tab.slice(1)} ({counts[tab]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-warm rounded-lg p-8 text-center text-ink/60">
          Nothing in this bucket.
        </div>
      ) : (
        <div className="bg-white border border-warm rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm bg-warm/30">
                <th className="text-left px-4 py-2 font-medium text-ink/70">Guest</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Contact</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Status</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Checked In</th>
                <th className="text-right px-4 py-2 font-medium text-ink/70">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className="border-b border-warm/50 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium">{row.guest.first_name}</span>
                    {row.guest.last_name && <span className="text-ink/70"> {row.guest.last_name}</span>}
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    {row.guest.email && <span className="block">{row.guest.email}</span>}
                    {row.guest.phone && <span className="block">{formatPhone(row.guest.phone)}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={paymentVariant[row.payment_status]}>
                      {row.payment_status}
                    </Badge>
                    {row.paid_at && (
                      <p className="text-xs text-ink/50 mt-1">
                        {new Date(row.paid_at).toLocaleDateString()}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    {row.checked_in_at ? (
                      <Badge variant="info">In</Badge>
                    ) : (
                      <span className="text-ink/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {row.payment_status === 'paid' ? (
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleResend(row)}
                          loading={busy === row.id}
                        >
                          Re-send
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleMarkUnpaid(row)}
                          loading={busy === row.id}
                        >
                          Undo
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleMarkPaid(row)}
                        loading={busy === row.id}
                      >
                        Mark paid
                      </Button>
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
