import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Event } from '../lib/types'
import { formatDate, formatTime, isUpcoming } from '../lib/utils/date'
import { PageLoader } from '../components/ui/LoadingSpinner'

export function Home() {
  const [events, setEvents] = useState<(Event & { rsvp_count: number })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadEvents()
  }, [])

  async function loadEvents() {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('is_published', true)
      .order('date', { ascending: true })

    if (data) {
      // Get RSVP counts for each event
      const eventsWithCounts = await Promise.all(
        data.filter(e => isUpcoming(e.date)).map(async (event) => {
          const { count } = await supabase
            .from('rsvps')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', event.id)
            .eq('status', 'yes')

          return { ...event, rsvp_count: count || 0 }
        })
      )
      setEvents(eventsWithCounts)
    }
    setLoading(false)
  }

  if (loading) return <PageLoader />

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="text-center mb-12">
        <h1 className="font-serif text-4xl md:text-5xl text-forest-dark mb-2">Cafe Kadhem</h1>
        <p className="font-script text-2xl md:text-3xl text-forest mb-4">
          &#1603;&#1575;&#1601;&#1610;&#1607; &#1603;&#1575;&#1592;&#1605;
        </p>
        <p className="text-ink/70 max-w-md mx-auto">
          An intimate dining experience. Join us for our upcoming events.
        </p>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-ink/60 font-serif text-lg">No upcoming events at the moment.</p>
          <p className="text-ink/40 mt-2">Check back soon for new events.</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {events.map(event => (
            <Link
              key={event.id}
              to={`/events/${event.id}`}
              className="block bg-white rounded-xl border border-warm overflow-hidden hover:shadow-lg transition-shadow"
            >
              {event.flyer_url && (
                <div className="aspect-[4/3] overflow-hidden">
                  <img
                    src={event.flyer_url}
                    alt={event.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="p-5">
                <h2 className="font-serif text-xl text-forest-dark mb-2">{event.title}</h2>
                <p className="text-sm text-ink/70 mb-1">
                  {formatDate(event.date)} at {formatTime(event.start_time)}
                </p>
                <p className="text-sm text-ink/60 mb-3">{event.location}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-forest font-medium">
                    {event.rsvp_count} {event.rsvp_count === 1 ? 'guest' : 'guests'} going
                  </span>
                  {event.capacity && (
                    <span className="text-xs text-ink/50">
                      {event.rsvp_count >= event.capacity ? 'Full' : `${event.capacity - event.rsvp_count} spots left`}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
