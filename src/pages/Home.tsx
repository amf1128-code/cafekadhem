import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Event } from '../lib/types'
import { formatDate, formatTime, isUpcoming } from '../lib/utils/date'
import { PageLoader } from '../components/ui/LoadingSpinner'

export function Home() {
  const [events, setEvents] = useState<(Event & { rsvp_count: number })[]>([])
  const [pastEvents, setPastEvents] = useState<Event[]>([])
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
      const upcoming = data.filter(e => isUpcoming(e.date))
      const past = data.filter(e => !isUpcoming(e.date)).reverse()

      const eventsWithCounts = await Promise.all(
        upcoming.map(async (event) => {
          const { count } = await supabase
            .from('rsvps')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', event.id)
            .eq('status', 'yes')

          return { ...event, rsvp_count: count || 0 }
        })
      )
      setEvents(eventsWithCounts)
      setPastEvents(past)
    }
    setLoading(false)
  }

  if (loading) return <PageLoader />

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      {/* Title area */}
      <div className="text-center mb-16">
        {/* "Cafe Kadhem" with Arabic behind at half opacity */}
        <div className="relative inline-block mb-4">
          <span className="absolute inset-0 flex items-center justify-center font-arabic text-6xl md:text-7xl text-forest/20 select-none pointer-events-none whitespace-nowrap" aria-hidden="true">
            &#1603;&#1575;&#1601;&#1610;&#1607; &#1603;&#1575;&#1592;&#1605;
          </span>
          <h1 className="relative font-serif text-2xl md:text-3xl text-forest px-8 py-4">
            Cafe Kadhem
          </h1>
        </div>
        <p className="font-serif text-lg text-ink-muted italic max-w-md mx-auto leading-relaxed">
          Curating Arab-inspired treats in NYC. There's always room for one more at our table.
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
          {events.map(event => (
            <Link
              key={event.id}
              to={`/events/${event.id}`}
              className="block group"
            >
              {/* Archival card */}
              <div className="relative border border-warm bg-parchment-light p-6 md:p-8 transition-colors hover:border-forest/40">
                {/* Vertical ref text on right edge — uses gathering_number from DB */}
                {event.gathering_number && (
                  <div className="absolute top-4 right-2 vertical-text text-[10px] tracking-[0.15em] uppercase text-stone-dark hidden md:block">
                    Gathering {event.gathering_number}
                  </div>
                )}

                {/* Top metadata row */}
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <p className="text-xs tracking-[0.2em] uppercase text-ink-muted mb-1">
                      Cafe Kadhem
                    </p>
                    <h2 className="font-serif text-2xl md:text-3xl text-forest-dark italic">
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

                {/* Flyer image — prefer home-specific image, fall back to full flyer.
                    Renders at the image's natural aspect ratio so admins can
                    upload a home-specific crop and have it shown intact. */}
                {(event.home_flyer_url || event.flyer_url) && (
                  <div className="relative mb-6">
                    <div className="border-4 border-white shadow-sm">
                      <img
                        src={event.home_flyer_url || event.flyer_url!}
                        alt={event.title}
                        className="w-full h-auto block"
                      />
                    </div>
                  </div>
                )}

                {/* Info row with thin dividers */}
                <div className="border-t border-b border-warm py-4 grid grid-cols-3 text-center">
                  <div className="border-r border-warm">
                    <div className="hidden sm:block">
                      {event.location_name && (
                        <p className="text-xs tracking-[0.15em] uppercase text-ink">
                          {event.location_name}
                        </p>
                      )}
                      <p className={`text-xs tracking-[0.15em] uppercase text-ink-muted ${event.location_name ? 'mt-0.5' : ''}`}>
                        {event.location}
                      </p>
                    </div>
                    <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1 sm:hidden">Date</p>
                    <p className="font-serif text-ink sm:hidden">{formatDate(event.date)}</p>
                  </div>
                  <div className="border-r border-warm">
                    {event.capacity ? (
                      event.capacity - event.rsvp_count > 0 ? (
                        <>
                          <p className="font-serif text-xl text-forest-dark">{event.capacity - event.rsvp_count}</p>
                          <p className="text-[10px] tracking-[0.15em] uppercase text-ink-muted">
                            {event.ticketing_enabled ? 'Tickets Left' : 'Seats Left'}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-serif text-base text-forest-dark">Event Full</p>
                          <p className="text-[10px] tracking-[0.15em] uppercase text-ink-muted">Join the Waitlist</p>
                        </>
                      )
                    ) : (
                      <>
                        <p className="font-serif text-xl text-forest-dark">{event.rsvp_count}</p>
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

                {/* Mobile location */}
                <div className="sm:hidden mt-4 text-sm text-ink-muted">
                  {event.location_name && <p className="font-medium text-ink">{event.location_name}</p>}
                  <p>{event.location}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Past Gatherings */}
      {pastEvents.length > 0 && (
        <div className="mt-16">
          <div className="text-center mb-8">
            <p className="text-[10px] tracking-[0.3em] uppercase text-ink-muted">Archive</p>
            <h2 className="font-serif text-xl text-forest-dark italic mt-1">Past Gatherings</h2>
          </div>
          <div className="space-y-4">
            {pastEvents.map(event => (
              <Link
                key={event.id}
                to={`/events/${event.id}`}
                className="block group"
              >
                <div className="border border-warm/60 bg-parchment-light/50 p-4 md:p-6 transition-colors hover:border-forest/30 opacity-80 hover:opacity-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-serif text-lg text-forest-dark italic">
                        {event.title}
                      </h3>
                      <p className="text-xs text-ink-muted mt-1">
                        {formatDate(event.date)}
                        {event.gathering_number && <span className="ml-3">Gathering {event.gathering_number}</span>}
                      </p>
                    </div>
                    {(event.home_flyer_url || event.flyer_url) && (
                      <div className="border-2 border-white shadow-sm ml-4 flex-shrink-0">
                        <img
                          src={event.home_flyer_url || event.flyer_url!}
                          alt={event.title}
                          className="w-16 h-16 object-cover"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
