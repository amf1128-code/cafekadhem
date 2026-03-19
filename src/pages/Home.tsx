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
    <div className="max-w-3xl mx-auto px-6 py-12">
      {/* Title area */}
      <div className="text-center mb-16">
        <p className="text-xs tracking-[0.3em] uppercase text-ink-muted mb-4">
          Cafe Kadhem Experiences
        </p>
        <h1 className="font-serif text-4xl md:text-5xl text-ink italic mb-4">
          Upcoming Gatherings
        </h1>
        <p className="font-serif text-lg text-ink-muted italic">
          An intimate dining experience. Join us at the table.
        </p>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-16">
          <p className="font-serif text-xl text-ink-muted italic">
            No upcoming gatherings at the moment.
          </p>
          <p className="text-sm text-ink-muted mt-3">Check back soon.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {events.map((event, index) => (
            <Link
              key={event.id}
              to={`/events/${event.id}`}
              className="block group"
            >
              {/* Archival card */}
              <div className="relative border border-stone bg-parchment-light p-6 md:p-8 transition-colors hover:border-ink-muted">
                {/* Vertical ref text on right edge */}
                <div className="absolute top-4 right-2 vertical-text text-[10px] tracking-[0.15em] uppercase text-stone-dark hidden md:block">
                  Gathering No. {String(index + 1).padStart(2, '0')}
                </div>

                {/* Top metadata row */}
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <p className="text-xs tracking-[0.2em] uppercase text-ink-muted mb-1">
                      Cafe Kadhem
                    </p>
                    <h2 className="font-serif text-2xl md:text-3xl text-ink italic">
                      {event.title}
                    </h2>
                  </div>
                  <div className="text-right text-sm hidden sm:block">
                    <div className="flex gap-8">
                      <div>
                        <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-0.5">Date</p>
                        <p className="font-serif text-ink">{formatDate(event.date)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-0.5">Time</p>
                        <p className="font-serif text-ink">{formatTime(event.start_time)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Flyer image — taped on */}
                {event.flyer_url && (
                  <div className="relative mb-6">
                    <div className="border-4 border-white shadow-sm">
                      <img
                        src={event.flyer_url}
                        alt={event.title}
                        className="w-full aspect-[16/9] object-cover"
                      />
                    </div>
                  </div>
                )}

                {/* Info row with thin dividers */}
                <div className="border-t border-b border-stone py-4 grid grid-cols-3 text-center">
                  <div className="border-r border-stone">
                    <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1 sm:hidden">Date</p>
                    <p className="text-xs tracking-[0.15em] uppercase text-ink-muted hidden sm:block">
                      {event.location}
                    </p>
                    <p className="font-serif text-ink sm:hidden">{formatDate(event.date)}</p>
                  </div>
                  <div className="border-r border-stone">
                    {event.capacity ? (
                      <>
                        <p className="font-serif text-xl text-ink">{event.capacity - event.rsvp_count > 0 ? event.capacity - event.rsvp_count : 0}</p>
                        <p className="text-[10px] tracking-[0.15em] uppercase text-ink-muted">
                          {event.rsvp_count >= event.capacity ? 'Waitlist' : 'Seats Left'}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-serif text-xl text-ink">{event.rsvp_count}</p>
                        <p className="text-[10px] tracking-[0.15em] uppercase text-ink-muted">Guests</p>
                      </>
                    )}
                  </div>
                  <div>
                    <p className="text-xs tracking-[0.15em] uppercase text-ink-muted">
                      RSVP Required
                    </p>
                  </div>
                </div>

                {/* Mobile date/location */}
                <div className="sm:hidden mt-4 text-sm text-ink-muted">
                  <p>{event.location}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
