import { Link } from 'react-router-dom'
import { useSampleEvent } from './sampleEvent'
import { formatDate, formatTime } from '../../../lib/utils/date'

/**
 * Option 3 — "Magasin Général"
 *
 * The souk reference: a bold red Arabic logo dominates the header, all-caps
 * Latin nav threads underneath, and the hero is a surreal collage — event flyer
 * floating in front of architectural fragments. Asymmetric grid, lots of
 * negative space, but with concentrated maximalism in specific zones.
 */
export function Option3MagasinGeneral() {
  const { event } = useSampleEvent()

  return (
    <div className="min-h-screen bg-white text-[#222]">
      {/* Top utility strip */}
      <div className="border-b border-black/10 px-6 md:px-12 py-2 flex justify-between text-[10px] uppercase tracking-[0.3em]">
        <span className="text-[#C92121] font-bold">General Store</span>
        <span className="opacity-70">Brooklyn → Globally</span>
        <span className="text-[#C92121] font-bold">Magasin Général</span>
      </div>

      {/* Wordmark header */}
      <header className="px-6 md:px-12 py-10 flex flex-col items-center text-center border-b border-black/10">
        <div
          className="font-[Amiri] text-[#C92121] leading-none"
          style={{ fontSize: 'clamp(80px, 14vw, 180px)' }}
        >
          كافيه كاظم
        </div>
        <div className="text-[10px] tracking-[0.5em] mt-3 opacity-60">EST. 2025</div>
        <nav className="mt-6 flex flex-wrap gap-x-8 gap-y-2 justify-center text-[11px] tracking-[0.25em] uppercase font-bold">
          <a href="#">Browse all</a>
          <a href="#" className="text-[#C92121]">New!</a>
          <a href="#">Events</a>
          <a href="#">Menu</a>
          <a href="#">Tickets</a>
          <a href="#">Press</a>
          <a href="#">Contact</a>
        </nav>
      </header>

      {/* Surreal collage hero */}
      <section className="relative overflow-hidden border-b border-black/10">
        <div className="max-w-6xl mx-auto px-6 md:px-12 py-20 grid md:grid-cols-12 gap-8 items-center min-h-[640px] relative">
          {/* Floating chunks */}
          <div
            className="absolute top-12 right-[15%] w-40 h-40 opacity-90"
            style={{
              background: '#E8DCC8',
              clipPath:
                'polygon(20% 0%, 80% 5%, 100% 35%, 95% 75%, 70% 100%, 30% 95%, 5% 70%, 0% 30%)',
              boxShadow: 'inset -20px -20px 40px rgba(0,0,0,0.15)',
            }}
          />
          <div
            className="absolute bottom-10 left-[8%] w-56 h-32 opacity-80"
            style={{
              background: '#D6CDB8',
              clipPath:
                'polygon(0% 30%, 30% 0%, 75% 10%, 100% 50%, 85% 90%, 40% 100%, 5% 80%)',
              boxShadow: 'inset 15px 15px 30px rgba(0,0,0,0.18)',
            }}
          />
          <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-b from-[#C9E0DC] via-transparent to-transparent opacity-50" />

          <div className="md:col-span-5 relative z-10">
            <div className="text-[10px] tracking-[0.4em] uppercase text-[#C92121] font-bold mb-4">
              Featured This Spring
            </div>
            <h1
              className="leading-[0.95] mb-6"
              style={{
                fontFamily: '"DM Serif Display", "Playfair Display", serif',
                fontSize: 'clamp(48px, 6.5vw, 96px)',
              }}
            >
              {event.title}.
            </h1>
            <p className="text-[#444] text-base leading-relaxed max-w-md">
              {event.description}
            </p>
            <div className="mt-8 flex items-center gap-4">
              <Link
                to="#"
                className="inline-block px-7 py-3 bg-[#C92121] text-white text-[11px] tracking-[0.3em] uppercase font-bold hover:bg-black transition"
              >
                Reserve →
              </Link>
              <Link to="#" className="text-[11px] tracking-[0.3em] uppercase font-bold underline underline-offset-4">
                See the menu
              </Link>
            </div>
          </div>

          {/* Floating flyer */}
          <div className="md:col-span-7 relative z-10">
            <div
              className="relative mx-auto max-w-sm aspect-[3/4] bg-[#1A21BC] text-[#EFE3CE] p-8 rotate-[-4deg]"
              style={{
                boxShadow: '20px 20px 0 rgba(201,33,33,0.15), 30px 30px 60px rgba(0,0,0,0.25)',
              }}
            >
              <div
                className="absolute inset-0 opacity-30 pointer-events-none"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(0deg, rgba(255,255,255,0.1) 0 1px, transparent 1px 4px)',
                }}
              />
              <div className="relative h-full flex flex-col justify-between">
                <div className="font-[Amiri] text-3xl text-center">كافيه كاظم</div>
                <div>
                  <div
                    className="font-bold uppercase leading-[0.9]"
                    style={{
                      fontFamily: '"Anton", Impact, sans-serif',
                      fontSize: 'clamp(32px, 5vw, 56px)',
                    }}
                  >
                    {event.title}
                  </div>
                  <div className="mt-3 text-xs tracking-[0.3em] uppercase opacity-90">
                    {formatDate(event.date)} · {formatTime(event.start_time)}
                  </div>
                </div>
                <div className="border-t border-[#EFE3CE]/30 pt-3 text-[10px] uppercase tracking-[0.3em] flex justify-between">
                  <span>Doors {formatTime(event.start_time)}</span>
                  <span>${(event.ticket_price ?? 0) / 100}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Event detail strip */}
      <section className="px-6 md:px-12 py-16 bg-[#F8F4ED]">
        <div className="max-w-6xl mx-auto grid md:grid-cols-12 gap-10">
          <div className="md:col-span-4">
            <div className="text-[10px] tracking-[0.4em] uppercase text-[#C92121] font-bold mb-2">
              The night
            </div>
            <h2
              className="leading-[0.95]"
              style={{
                fontFamily: '"DM Serif Display", serif',
                fontSize: 'clamp(40px, 5vw, 72px)',
              }}
            >
              {event.title}
            </h2>
          </div>
          <div className="md:col-span-5 text-base leading-relaxed text-[#333]">
            {event.description}
            <p className="mt-4 text-[#666] italic">{event.donation_info}</p>
          </div>
          <aside className="md:col-span-3 border-l-2 border-[#C92121] pl-6 space-y-4 text-sm">
            <Detail label="When" value={`${formatDate(event.date)} · ${formatTime(event.start_time)}`} />
            <Detail label="Where" value={event.location_name ?? event.location} />
            <Detail label="Address" value={event.location} />
            <Detail label="Capacity" value={`${event.capacity ?? '—'} seats`} />
            <Detail label="Price" value={`$${(event.ticket_price ?? 0) / 100}`} />
          </aside>
        </div>
      </section>

      <footer className="px-6 md:px-12 py-8 border-t border-black/10 flex justify-between text-[10px] uppercase tracking-[0.3em] opacity-70">
        <span>كافيه كاظم</span>
        <span>167 Utica Ave · Brooklyn</span>
        <span>© Cafe Kadhem</span>
      </footer>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.3em] uppercase text-[#C92121] font-bold mb-0.5">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  )
}
