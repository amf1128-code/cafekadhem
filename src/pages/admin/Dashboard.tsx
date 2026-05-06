import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Event, RSVP, PublicGuestProfile } from '../../lib/types'
import { formatDate, formatTime, isUpcoming } from '../../lib/utils/date'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'

export function AdminDashboard() {
  type EventWithCounts = Event & { rsvp_yes: number; rsvp_maybe: number; rsvp_waitlisted: number; order_count: number }
  const [events, setEvents] = useState<EventWithCounts[]>([])
  const [pastEvents, setPastEvents] = useState<EventWithCounts[]>([])
  const [recentRsvps, setRecentRsvps] = useState<(RSVP & { guest: PublicGuestProfile; event_title: string })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    // Load events
    const { data: eventsData } = await supabase
      .from('events')
      .select('*')
      .order('date', { ascending: true })

    if (eventsData) {
      const withCounts = await Promise.all(
        eventsData.map(async (event) => {
          const [yesResult, maybeResult, waitlistedResult, orderResult] = await Promise.all([
            supabase.from('rsvps').select('*', { count: 'exact', head: true }).eq('event_id', event.id).eq('status', 'yes'),
            supabase.from('rsvps').select('*', { count: 'exact', head: true }).eq('event_id', event.id).eq('status', 'maybe'),
            supabase.from('rsvps').select('*', { count: 'exact', head: true }).eq('event_id', event.id).eq('status', 'waitlisted'),
            supabase.from('orders').select('*', { count: 'exact', head: true }).eq('event_id', event.id),
          ])
          return {
            ...event,
            rsvp_yes: yesResult.count || 0,
            rsvp_maybe: maybeResult.count || 0,
            rsvp_waitlisted: waitlistedResult.count || 0,
            order_count: orderResult.count || 0,
          }
        })
      )
      setEvents(withCounts.filter(e => isUpcoming(e.date)))
      setPastEvents(withCounts.filter(e => !isUpcoming(e.date)).reverse())
    }

    // Load recent RSVPs
    const { data: rsvpData } = await supabase
      .from('rsvps')
      .select('*, guest:public_guest_profiles!guest_id(*)')
      .order('created_at', { ascending: false })
      .limit(20)

    if (rsvpData) {
      // Get event titles
      const eventIds = [...new Set(rsvpData.map(r => r.event_id))]
      const { data: eventTitles } = await supabase
        .from('events')
        .select('id, title')
        .in('id', eventIds)

      const titleMap = new Map(eventTitles?.map(e => [e.id, e.title]) || [])

      setRecentRsvps(
        rsvpData.map(r => ({
          ...r,
          event_title: titleMap.get(r.event_id) || 'Unknown Event',
        })) as (RSVP & { guest: PublicGuestProfile; event_title: string })[]
      )
    }

    setLoading(false)
  }

  if (loading) return <PageLoader />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-2xl text-forest-dark">Dashboard</h1>
        <Link to="/admin/events/new">
          <Button>Create Event</Button>
        </Link>
      </div>

      {/* Upcoming Events */}
      <h2 className="font-serif text-lg text-forest-dark mb-3">Upcoming Events</h2>
      {events.length === 0 ? (
        <p className="text-ink/60 text-sm mb-8">No upcoming events.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 mb-8">
          {events.map(event => (
            <div key={event.id} className="bg-white border border-warm rounded-lg p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-serif text-lg text-forest-dark">{event.title}</h3>
                <Badge variant={event.is_published ? 'success' : 'warning'}>
                  {event.is_published ? 'Published' : 'Draft'}
                </Badge>
              </div>
              <p className="text-sm text-ink/60 mb-3">
                {formatDate(event.date)} at {formatTime(event.start_time)}
              </p>
              <div className="flex gap-4 text-sm text-ink/70 mb-3">
                <span>{event.rsvp_yes} going</span>
                <span>{event.rsvp_maybe} maybe</span>
                {event.rsvp_waitlisted > 0 && (
                  <span className="text-amber-700">{event.rsvp_waitlisted} waitlisted</span>
                )}
                <span>{event.order_count} orders</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Link to={`/admin/events/${event.id}/edit`}>
                  <Button variant="outline" size="sm">Edit</Button>
                </Link>
                {event.ticketing_enabled && (
                  <>
                    <Link to={`/admin/events/${event.id}/tickets`}>
                      <Button variant="ghost" size="sm">Tickets</Button>
                    </Link>
                    <Link to={`/admin/events/${event.id}/checkin`}>
                      <Button variant="ghost" size="sm">Door</Button>
                    </Link>
                  </>
                )}
                <Link to={`/admin/events/${event.id}/orders`}>
                  <Button variant="ghost" size="sm">Orders</Button>
                </Link>
                <Link to={`/admin/events/${event.id}/invite`}>
                  <Button variant="ghost" size="sm">Invite</Button>
                </Link>
                <Link to={`/admin/events/${event.id}/blast`}>
                  <Button variant="ghost" size="sm">Blast</Button>
                </Link>
                {event.rsvp_waitlisted > 0 && (
                  <Link to={`/admin/events/${event.id}/waitlist`}>
                    <Button variant="ghost" size="sm">Waitlist</Button>
                  </Link>
                )}
                <Link to={`/events/${event.id}`} target="_blank">
                  <Button variant="ghost" size="sm">View</Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Past Events */}
      <h2 className="font-serif text-lg text-forest-dark mb-3">Past Events</h2>
      {pastEvents.length === 0 ? (
        <p className="text-ink/60 text-sm mb-8">No past events.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 mb-8">
          {pastEvents.map(event => (
            <div key={event.id} className="bg-white/70 border border-warm/60 rounded-lg p-4 opacity-80">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-serif text-lg text-forest-dark">{event.title}</h3>
                <Badge variant={event.is_published ? 'success' : 'warning'}>
                  {event.is_published ? 'Published' : 'Draft'}
                </Badge>
              </div>
              <p className="text-sm text-ink/60 mb-3">
                {formatDate(event.date)} at {formatTime(event.start_time)}
              </p>
              <div className="flex gap-4 text-sm text-ink/70 mb-3">
                <span>{event.rsvp_yes} went</span>
                <span>{event.order_count} orders</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Link to={`/admin/events/${event.id}/edit`}>
                  <Button variant="outline" size="sm">Edit</Button>
                </Link>
                <Link to={`/admin/events/${event.id}/blast`}>
                  <Button variant="ghost" size="sm">Blast</Button>
                </Link>
                <Link to={`/events/${event.id}`} target="_blank">
                  <Button variant="ghost" size="sm">View</Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent RSVPs */}
      <h2 className="font-serif text-lg text-forest-dark mb-3">Recent RSVPs</h2>
      {recentRsvps.length === 0 ? (
        <p className="text-ink/60 text-sm">No RSVPs yet.</p>
      ) : (
        <div className="bg-white border border-warm rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm bg-warm/30">
                <th className="text-left px-4 py-2 font-medium text-ink/70">Guest</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Event</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentRsvps.map(rsvp => (
                <tr key={rsvp.id} className="border-b border-warm/50 last:border-0">
                  <td className="px-4 py-2">{rsvp.guest?.first_name || 'Unknown'}</td>
                  <td className="px-4 py-2 text-ink/70">{rsvp.event_title}</td>
                  <td className="px-4 py-2">
                    <Badge variant={rsvp.status === 'yes' ? 'success' : rsvp.status === 'maybe' ? 'warning' : rsvp.status === 'waitlisted' ? 'info' : 'default'}>
                      {rsvp.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick Links */}
      <div className="mt-8 flex gap-3 flex-wrap">
        <Link to="/admin/menus"><Button variant="outline">Manage Menus</Button></Link>
        <Link to="/admin/pickup"><Button variant="outline">Pickup Orders</Button></Link>
        <Link to="/admin/guests"><Button variant="outline">Guest Directory</Button></Link>
        <Link to="/admin/settings"><Button variant="outline">Settings</Button></Link>
        <Link to="/admin/design-preview"><Button variant="outline">Design Previews</Button></Link>
      </div>
    </div>
  )
}
