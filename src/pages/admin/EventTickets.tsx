import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Event, RSVP, Guest } from '../../lib/types'
import { formatDate, formatTime } from '../../lib/utils/date'
import { formatPhone } from '../../lib/utils/phone'
import { sendNotification } from '../../lib/notifications'
import { createAndSendBlast } from '../../lib/notifications/blast'
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
  const [blasting, setBlasting] = useState<null | 'remind' | 'nudge'>(null)

  // One-click reminder/nudge audiences. "Unpaid" = a held seat (status
  // 'yes') without confirmed payment — matching the unpaid_tickets blast
  // audience. Maybes are nudged regardless of payment (they never began
  // paying); nudging never changes anyone's RSVP.
  const unpaidTicketCount = useMemo(
    () =>
      rows.filter(
        r =>
          r.status === 'yes' &&
          (r.payment_status === 'unpaid' || r.payment_status === 'pending'),
      ).length,
    [rows],
  )
  const maybeCount = useMemo(
    () => rows.filter(r => r.status === 'maybe').length,
    [rows],
  )

  useEffect(() => {
    if (id) loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadData() {
    // Show every RSVP for this event that has any payment activity
    // (paid / pending / unpaid for a ticketed event), regardless of
    // RSVP status. A guest who paid then declined still shows up so
    // the host can refund or comp the stub. Plus-ones excluded —
    // they never pay separately. USER_FLOWS_SPEC.md §4.3.
    const [eventResult, rsvpResult] = await Promise.all([
      supabase.from('events').select('*').eq('id', id!).single(),
      supabase
        .from('rsvps')
        .select('*, guest:guests!guest_id(*)')
        .eq('event_id', id!)
        .is('plus_one_of', null)
        .order('created_at', { ascending: true }),
    ])

    if (eventResult.data) setEvent(eventResult.data)
    if (rsvpResult.data) setRows(rsvpResult.data as TicketRow[])
    setLoading(false)
  }

  async function handleMarkPaid(row: TicketRow) {
    setBusy(row.id)
    try {
      const { error } = await supabase.rpc('mark_rsvp_paid', { p_rsvp_id: row.id })
      if (error) throw error

      // Re-fetch the row to get the issued ticket_token. The RPC returns a
      // composite type whose JS-client shape is inconsistent enough that
      // reading ticket_token off the rpc() return value can't be trusted;
      // a fresh select is unambiguous.
      const { data: refreshed, error: fetchError } = await supabase
        .from('rsvps')
        .select('ticket_token')
        .eq('id', row.id)
        .single()

      if (fetchError || !refreshed?.ticket_token) {
        throw new Error('Ticket marked paid, but token was not issued')
      }

      addToast('Marked paid — issuing ticket')

      sendNotification({
        guestId: row.guest_id,
        eventId: id!,
        type: 'ticket_issued',
        data: { ticket_token: refreshed.ticket_token },
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

  async function handleRemindUnpaid() {
    if (!event || unpaidTicketCount === 0) return
    if (
      !confirm(
        `Send a payment reminder to ${unpaidTicketCount} guest${unpaidTicketCount === 1 ? '' : 's'} who haven't paid for their ticket? They'll be emailed/texted now.`,
      )
    )
      return
    setBlasting('remind')
    try {
      const amount = event.ticket_price?.toFixed(2) ?? '0.00'
      const { sent, failed } = await createAndSendBlast({
        eventId: event.id,
        audience: 'unpaid_tickets',
        emailSubject: `Your ticket for ${event.title} isn't paid yet`,
        emailBody: `Hi! We're holding your spot for ${event.title}, but we don't have your payment confirmed yet. Tickets are $${amount}. Open the event page below to pay by Venmo and lock in your seat.`,
        smsBody: `Reminder: we don't have payment for your $${amount} ticket to ${event.title} yet. Open the event to pay and confirm your seat:`,
      })
      addToast(`Reminder sent — ${sent} delivered${failed > 0 ? `, ${failed} failed` : ''}`)
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to send reminder', 'error')
    } finally {
      setBlasting(null)
    }
  }

  async function handleNudgeMaybes() {
    if (!event || maybeCount === 0) return
    if (
      !confirm(
        `Send a nudge to ${maybeCount} guest${maybeCount === 1 ? '' : 's'} who RSVPed "maybe"? They'll be emailed/texted now — no one's RSVP changes.`,
      )
    )
      return
    setBlasting('nudge')
    try {
      const amount = event.ticket_price?.toFixed(2) ?? '0.00'
      const { sent, failed } = await createAndSendBlast({
        eventId: event.id,
        audience: 'maybes',
        emailSubject: `Still thinking about ${event.title}?`,
        emailBody: `You marked yourself as a "maybe" for ${event.title}. Seats are limited and tickets are $${amount} — if you're in, open the event page below to grab your ticket before it fills up.`,
        smsBody: `Still thinking about ${event.title}? Seats are limited — open the event to grab your $${amount} ticket:`,
      })
      addToast(`Nudge sent — ${sent} delivered${failed > 0 ? `, ${failed} failed` : ''}`)
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to send nudge', 'error')
    } finally {
      setBlasting(null)
    }
  }

  // Per-row sends. Single-guest, through send-notification (like
  // Re-send), so each click sends again — no dedup. The amount is passed
  // for the copy; the message links back to the event page where the
  // guest's own Venmo card lives.
  async function handleRemindOne(row: TicketRow) {
    setBusy(row.id)
    try {
      const amount = event?.ticket_price?.toFixed(2) ?? '0.00'
      const res = await sendNotification({
        guestId: row.guest_id,
        eventId: id!,
        type: 'payment_reminder',
        data: { amount },
      })
      if (res.success) addToast(`Reminder sent to ${row.guest.first_name}`)
      else addToast(res.error || 'Failed to send reminder', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function handleNudgeOne(row: TicketRow) {
    setBusy(row.id)
    try {
      const amount = event?.ticket_price?.toFixed(2) ?? '0.00'
      const res = await sendNotification({
        guestId: row.guest_id,
        eventId: id!,
        type: 'maybe_nudge',
        data: { amount },
      })
      if (res.success) addToast(`Nudge sent to ${row.guest.first_name}`)
      else addToast(res.error || 'Failed to send nudge', 'error')
    } finally {
      setBusy(null)
    }
  }

  // Silent removal: deletes this RSVP for this event (and its +1 via the
  // ON DELETE CASCADE fk). No notification is sent. The guest record and
  // their RSVPs to other events are untouched — for a full wipe, use the
  // Guest Directory. Admins can delete rsvps directly (RLS: FOR ALL).
  async function handleRemove(row: TicketRow) {
    const name = `${row.guest.first_name}${row.guest.last_name ? ` ${row.guest.last_name}` : ''}`
    const paidWarn =
      row.payment_status === 'paid' ? ' They have a PAID ticket — it will be deleted.' : ''
    if (
      !confirm(
        `Remove ${name} from this event?${paidWarn} Their +1 (if any) goes too. They won't be notified, and this can't be undone.`,
      )
    )
      return
    setBusy(row.id)
    try {
      const { error } = await supabase.from('rsvps').delete().eq('id', row.id)
      if (error) throw error
      addToast(`Removed ${row.guest.first_name}`)
      await loadData()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to remove', 'error')
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

      {/* Bulk reminders — one-click sends through the blast engine, so
          both show up in this event's blast history. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[10px] tracking-[0.2em] uppercase text-ink/50 mr-1">
          Reminders
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRemindUnpaid}
          loading={blasting === 'remind'}
          disabled={unpaidTicketCount === 0 || blasting !== null}
        >
          Remind to pay ({unpaidTicketCount})
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleNudgeMaybes}
          loading={blasting === 'nudge'}
          disabled={maybeCount === 0 || blasting !== null}
        >
          Nudge maybes ({maybeCount})
        </Button>
        <Link to={`/admin/events/${id}/blast`} className="ml-auto">
          <Button size="sm" variant="ghost">
            Custom blast →
          </Button>
        </Link>
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
                <th className="text-left px-4 py-2 font-medium text-ink/70">RSVP</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Payment</th>
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
                    <Badge
                      variant={
                        row.status === 'yes' ? 'success'
                        : row.status === 'waitlisted' ? 'warning'
                        : 'default'
                      }
                    >
                      {row.status}
                    </Badge>
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
                    <div className="flex gap-2 justify-end flex-wrap">
                      {row.payment_status === 'paid' ? (
                        <>
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
                        </>
                      ) : (
                        <>
                          {row.status === 'yes' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRemindOne(row)}
                              loading={busy === row.id}
                            >
                              Remind
                            </Button>
                          )}
                          {row.status === 'maybe' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleNudgeOne(row)}
                              loading={busy === row.id}
                            >
                              Nudge
                            </Button>
                          )}
                          <Button
                            size="sm"
                            onClick={() => handleMarkPaid(row)}
                            loading={busy === row.id}
                          >
                            Mark paid
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(row)}
                        loading={busy === row.id}
                      >
                        Remove
                      </Button>
                    </div>
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
