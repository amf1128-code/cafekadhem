import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Event } from '../lib/types'
import { formatDate, formatTime, isUpcoming } from '../lib/utils/date'
import { CursorSticker } from '../components/CursorSticker'
import { PageLoader } from '../components/ui/LoadingSpinner'
import { useTheme, usePageTheme, type ThemeId } from '../lib/theme/themes'

export function Home() {
  const { siteTheme } = useTheme()
  const [events, setEvents] = useState<(Event & { rsvp_count: number })[]>([])
  const [pastEvents, setPastEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

  // Resolve the home page's theme: an explicit site setting wins outright;
  // otherwise follow the next upcoming event's theme (events[0] is the
  // soonest after the date sort below). While events are still loading we
  // pass `undefined` so usePageTheme leaves the previously-applied theme
  // in place — this keeps the cached theme on screen instead of flashing
  // theme1 in the gap before the fetch resolves.
  const homeTheme: ThemeId | undefined =
    siteTheme !== 'default'
      ? siteTheme
      : loading
        ? undefined
        : (events[0]?.theme ?? 'theme1')
  usePageTheme(homeTheme)

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
    <div className="max-w-3xl mx-auto px-6 pt-6 pb-12 md:pt-10">
      {/* Title area — Arabic wordmark sized to span ~75% of the card with
          the English brand layered in front. This is the only place we
          render the Cafe Kadhem lockup; the header is intentionally
          chrome-light to avoid duplicating it. */}
      <div className="text-center mb-6 md:mb-8">
        <div className="relative inline-block leading-none">
          <span
            className="block font-arabic text-forest/25 select-none pointer-events-none whitespace-nowrap leading-none text-[14vw] md:text-[7rem]"
            aria-hidden="true"
          >
            &#1603;&#1575;&#1601;&#1610;&#1607; &#1603;&#1575;&#1592;&#1605;
          </span>
          <h1 className="absolute inset-0 flex items-center justify-center font-serif text-forest text-3xl sm:text-4xl md:text-6xl">
            Cafe Kadhem
          </h1>
        </div>
        <p className="font-serif text-base md:text-lg text-ink-muted italic mx-auto leading-snug whitespace-normal md:whitespace-nowrap mt-3 md:mt-4">
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
                      {event.event_type || 'Cafe Kadhem'}
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
                        loading="lazy"
                        decoding="async"
                        className="w-full h-auto block"
                      />
                    </div>
                  </div>
                )}

                {/* Info row with thin dividers — items-center keeps the
                    RSVP label vertically aligned with the date/seats columns. */}
                <div className="border-t border-b border-warm py-4 grid grid-cols-3 items-center text-center">
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
                      {event.rsvp_required ? 'RSVP Required' : 'RSVP Requested'}
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
                          loading="lazy"
                          decoding="async"
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

      {/* Cursor sticker — orange Arabic pill that follows the cursor and
          cycles phrases on click. Brand "personality moment". */}
      <CursorSticker />
    </div>
  )
}
