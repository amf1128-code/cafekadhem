import { Link } from 'react-router-dom'
import { useSampleEvent } from './sampleEvent'
import { formatDate, formatTime } from '../../../lib/utils/date'

/**
 * Option 1 — "Birthday Poster"
 *
 * Direct lift of the green/pink stripe poster: vertical-stripe page, ultramarine
 * condensed display type, Arabic above Latin, B&W cutout photography, taped-on
 * candid feel. Stack-first vertical layout, almost zine-like.
 */
export function Option1BirthdayPoster() {
  const { event } = useSampleEvent()

  return (
    <div className="min-h-screen bg-[#E8DFC8] text-[#1A21BC] font-sans">
      {/* Stripe ground */}
      <div
        className="absolute inset-0 pointer-events-none opacity-90"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, #B6CDC0 0 36px, #E8DFC8 36px 72px)',
        }}
      />
      <div className="relative">
        {/* Top bar */}
        <header className="px-6 md:px-12 pt-6 flex items-center justify-between text-[#1A21BC]">
          <div className="font-[Amiri] text-3xl md:text-4xl leading-none">كافيه كاظم</div>
          <nav className="flex gap-6 uppercase text-xs tracking-[0.2em] font-bold">
            <a href="#events">Events</a>
            <a href="#menu">Menu</a>
            <a href="#visit">Visit</a>
          </nav>
        </header>

        {/* Hero */}
        <section className="px-6 md:px-12 pt-10 pb-20">
          <div className="max-w-5xl mx-auto">
            <div className="font-[Amiri] text-center text-4xl md:text-6xl mb-2">{`كافيه كاظم`}</div>
            <h1
              className="text-center font-black uppercase leading-[0.85] tracking-tight"
              style={{
                fontFamily: '"Anton", "Bebas Neue", Impact, sans-serif',
                fontSize: 'clamp(72px, 14vw, 220px)',
                letterSpacing: '-0.02em',
              }}
            >
              {event.title.toUpperCase()}
            </h1>
            <p className="text-center mt-4 text-lg md:text-2xl uppercase tracking-[0.15em] font-bold">
              {event.location}
            </p>

            {/* Cutout photo with tape */}
            <div className="relative mt-12 mx-auto max-w-md">
              <div
                className="absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-7 bg-[#F0E7C8]/80 rotate-[-4deg]"
                style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}
              />
              <div className="aspect-[3/4] bg-[#1A21BC]/10 grid place-items-center overflow-hidden">
                <div
                  className="w-full h-full"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle at 50% 35%, rgba(26,33,188,0.05) 0%, rgba(26,33,188,0.0) 60%), repeating-linear-gradient(45deg, rgba(26,33,188,0.18) 0 1px, transparent 1px 4px)',
                  }}
                >
                  <div className="h-full w-full grid place-items-center text-[#1A21BC]/40 text-xs uppercase tracking-[0.4em]">
                    halftone photo
                  </div>
                </div>
              </div>
            </div>

            {/* Date plate */}
            <div className="mt-12 grid grid-cols-3 max-w-2xl mx-auto border-y-[3px] border-[#1A21BC] py-4 text-center">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] mb-1">Date</div>
                <div className="font-[Anton] text-3xl">{formatDate(event.date)}</div>
              </div>
              <div className="border-x-[3px] border-[#1A21BC]">
                <div className="text-xs uppercase tracking-[0.3em] mb-1">Time</div>
                <div className="font-[Anton] text-3xl">{formatTime(event.start_time)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.3em] mb-1">Door</div>
                <div className="font-[Anton] text-3xl">${(event.ticket_price ?? 0) / 100}</div>
              </div>
            </div>

            <div className="mt-10 text-center">
              <Link
                to="#"
                className="inline-block px-10 py-4 bg-[#1A21BC] text-[#E8DFC8] font-[Anton] text-2xl uppercase tracking-[0.15em] border-[3px] border-[#1A21BC] hover:bg-transparent hover:text-[#1A21BC] transition"
              >
                Get Tickets →
              </Link>
            </div>
          </div>
        </section>

        {/* Event detail block */}
        <section id="events" className="px-6 md:px-12 py-16 bg-[#1A21BC] text-[#E8DFC8]">
          <div className="max-w-5xl mx-auto">
            <div className="text-xs uppercase tracking-[0.4em] mb-4 opacity-80">Now booking</div>
            <h2
              className="font-black uppercase leading-[0.9]"
              style={{ fontFamily: '"Anton", Impact, sans-serif', fontSize: 'clamp(48px, 8vw, 120px)' }}
            >
              {event.title.toUpperCase()}
            </h2>
            <div className="mt-8 grid md:grid-cols-3 gap-10">
              <div className="md:col-span-2 text-lg leading-relaxed">
                {event.description}
              </div>
              <aside className="border-l-[3px] border-[#E8DFC8] pl-6 space-y-4 text-sm uppercase tracking-[0.15em]">
                <div>
                  <div className="opacity-60 text-xs">When</div>
                  <div className="font-[Anton] text-xl normal-case tracking-normal">
                    {formatDate(event.date)} · {formatTime(event.start_time)}
                  </div>
                </div>
                <div>
                  <div className="opacity-60 text-xs">Where</div>
                  <div className="font-[Anton] text-xl normal-case tracking-normal">
                    {event.location_name ?? event.location}
                  </div>
                </div>
                <div>
                  <div className="opacity-60 text-xs">Capacity</div>
                  <div className="font-[Anton] text-xl normal-case tracking-normal">
                    {event.capacity ?? '—'} seats
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>

        <footer className="px-6 md:px-12 py-8 text-center text-xs uppercase tracking-[0.4em] text-[#1A21BC]">
          كافيه كاظم · Brooklyn · Since 2025
        </footer>
      </div>
    </div>
  )
}
