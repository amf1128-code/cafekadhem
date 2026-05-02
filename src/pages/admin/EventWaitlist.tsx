import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Event, RSVP, Guest } from '../../lib/types'
import { formatDate, formatTime } from '../../lib/utils/date'
import { formatPhone } from '../../lib/utils/phone'
import { instagramUrl } from '../../lib/utils/instagram'
import { sendNotification } from '../../lib/notifications'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'

type WaitlistEntry = RSVP & { guest: Guest }

export function AdminEventWaitlist() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [event, setEvent] = useState<Event | null>(null)
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
  const [yesCount, setYesCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [promoting, setPromoting] = useState<string | null>(null)

  useEffect(() => {
    if (id) loadData()
  }, [id])

  async function loadData() {
    const [eventResult, waitlistResult, yesResult] = await Promise.all([
      supabase.from('events').select('*').eq('id', id!).single(),
      supabase
        .from('rsvps')
        .select('*, guest:guests(*)')
        .eq('event_id', id!)
        .eq('status', 'waitlisted')
        .order('waitlist_position', { ascending: true }),
      supabase
        .from('rsvps')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', id!)
        .eq('status', 'yes'),
    ])

    if (eventResult.data) setEvent(eventResult.data)
    if (waitlistResult.data) setWaitlist(waitlistResult.data as WaitlistEntry[])
    setYesCount(yesResult.count || 0)
    setLoading(false)
  }

  async function handlePromote(rsvpId: string, guestId: string) {
    setPromoting(rsvpId)
    try {
      const { data, error } = await supabase.rpc('promote_from_waitlist', {
        p_rsvp_id: rsvpId,
      })

      if (error) throw error

      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        addToast(result.error || 'Failed to promote', 'error')
        return
      }

      addToast('Guest promoted from waitlist')

      // Send notification to promoted guest. Pass ticketing context so the
      // template can prompt for payment when this event requires a paid
      // ticket. The edge function builds event_url from admin_settings.site_url.
      sendNotification({
        guestId,
        eventId: id!,
        type: 'waitlist_promoted',
        data: {
          is_ticketed: event?.ticketing_enabled ? 'true' : 'false',
        },
      })

      await loadData()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to promote', 'error')
    } finally {
      setPromoting(null)
    }
  }

  if (loading) return <PageLoader />

  if (!event) {
    return <p className="text-ink/60">Event not found.</p>
  }

  const spotsAvailable = event.capacity ? event.capacity - yesCount : null

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-forest-dark">{event.title} - Waitlist</h1>
          <p className="text-sm text-ink/60">
            {formatDate(event.date)} at {formatTime(event.start_time)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/admin/events/${id}/edit`}>
            <Button variant="ghost" size="sm">Edit Event</Button>
          </Link>
          <Link to={`/admin/events/${id}/orders`}>
            <Button variant="ghost" size="sm">Orders</Button>
          </Link>
        </div>
      </div>

      {/* Capacity Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-warm rounded-lg p-4 text-center">
          <p className="text-2xl font-serif text-forest-dark">{yesCount}</p>
          <p className="text-sm text-ink/60">
            Confirmed{event.capacity ? ` / ${event.capacity}` : ''}
          </p>
        </div>
        <div className="bg-white border border-warm rounded-lg p-4 text-center">
          <p className="text-2xl font-serif text-forest-dark">{waitlist.length}</p>
          <p className="text-sm text-ink/60">On Waitlist</p>
        </div>
        <div className="bg-white border border-warm rounded-lg p-4 text-center">
          <p className="text-2xl font-serif text-forest-dark">
            {spotsAvailable !== null ? spotsAvailable : '--'}
          </p>
          <p className="text-sm text-ink/60">Spots Open</p>
        </div>
      </div>

      {/* Waitlist Table */}
      {waitlist.length === 0 ? (
        <div className="bg-white border border-warm rounded-lg p-8 text-center">
          <p className="text-ink/60">No one on the waitlist.</p>
        </div>
      ) : (
        <div className="bg-white border border-warm rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm bg-warm/30">
                <th className="text-left px-4 py-2 font-medium text-ink/70">#</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Name</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Contact</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Instagram</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Waitlisted</th>
                <th className="text-right px-4 py-2 font-medium text-ink/70">Actions</th>
              </tr>
            </thead>
            <tbody>
              {waitlist.map(entry => (
                <tr key={entry.id} className="border-b border-warm/50 last:border-0">
                  <td className="px-4 py-3">
                    <Badge variant="default">#{entry.waitlist_position}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{entry.guest.first_name}</span>
                    {entry.guest.last_name && (
                      <span className="text-ink/70"> {entry.guest.last_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    {entry.guest.email && <span className="block">{entry.guest.email}</span>}
                    {entry.guest.phone && (
                      <span className="block">{formatPhone(entry.guest.phone)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {entry.guest.instagram ? (
                      <a
                        href={instagramUrl(entry.guest.instagram)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-forest hover:text-forest-light"
                      >
                        @{entry.guest.instagram}
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink/60">
                    {entry.waitlisted_at
                      ? new Date(entry.waitlisted_at).toLocaleDateString()
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      onClick={() => handlePromote(entry.id, entry.guest_id)}
                      loading={promoting === entry.id}
                    >
                      Promote
                    </Button>
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
