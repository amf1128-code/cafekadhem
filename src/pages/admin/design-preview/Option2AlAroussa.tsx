import { Link } from 'react-router-dom'
import { useSampleEvent } from './sampleEvent'
import { formatDate, formatTime } from '../../../lib/utils/date'

/**
 * Option 2 — "Al Aroussa"
 *
 * Vintage Egyptian magazine. Cream paper with grain, sepia/duotone images,
 * ornate Arabic display + Latin slab serif, narrow editorial column, ruled
 * lines and caption metadata. Dense, layered, magazine-cover energy.
 */
export function Option2AlAroussa() {
  const { event } = useSampleEvent()

  return (
    <div
      className="min-h-screen text-[#3A1F1A] font-[DM_Serif_Display]"
      style={{
        backgroundColor: '#EFE3CE',
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.45  0 0 0 0 0.25  0 0 0 0 0.15  0 0 0 0.12 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
      }}
    >
      {/* Masthead */}
      <header className="border-b-2 border-[#7A2E2E] py-6 px-6 md:px-12">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-6">
          <div className="text-xs tracking-[0.3em] uppercase opacity-70">Vol. I · No. 1</div>
          <div className="text-center flex-1">
            <div className="font-[Amiri] text-4xl md:text-5xl text-[#7A2E2E] leading-none">
              العروسة
            </div>
            <div className="text-xs tracking-[0.4em] uppercase mt-1">Al Aroussa · Cafe Kadhem</div>
          </div>
          <div className="text-xs tracking-[0.3em] uppercase opacity-70">Brooklyn</div>
        </div>
        <div className="mt-3 max-w-4xl mx-auto border-t border-[#7A2E2E]/40 pt-2 flex justify-between text-[10px] uppercase tracking-[0.3em] opacity-70">
          <span>Events</span>
          <span>Menu</span>
          <span>The Café</span>
          <span>Contact</span>
        </div>
      </header>

      {/* Hero — cover */}
      <section className="px-6 md:px-12 py-12">
        <div className="max-w-4xl mx-auto grid md:grid-cols-12 gap-10">
          <div className="md:col-span-7">
            <div className="text-xs uppercase tracking-[0.3em] text-[#7A2E2E] mb-3">
              The featured night
            </div>
            <h1
              className="text-[#7A2E2E] leading-[0.95]"
              style={{
                fontFamily: '"DM Serif Display", "Playfair Display", serif',
                fontSize: 'clamp(56px, 8vw, 110px)',
              }}
            >
              {event.title}
            </h1>
            <div className="font-[Amiri] text-3xl mt-3 text-[#3A1F1A]">كافيه كاظم</div>
            <p className="mt-6 text-lg leading-relaxed font-[Cormorant_Garamond] italic max-w-md">
              {event.description}
            </p>
            <div className="mt-8 flex items-center gap-6">
              <Link
                to="#"
                className="inline-block px-8 py-3 bg-[#7A2E2E] text-[#EFE3CE] font-[DM_Serif_Display] text-lg tracking-wide hover:bg-[#3A1F1A] transition"
              >
                Reserve a seat
              </Link>
              <span className="text-xs uppercase tracking-[0.3em] opacity-70 border-l border-[#7A2E2E]/40 pl-6">
                ${(event.ticket_price ?? 0) / 100} · {event.capacity} seats
              </span>
            </div>
          </div>
          <figure className="md:col-span-5">
            <div
              className="aspect-[3/4] relative overflow-hidden"
              style={{
                background:
                  'linear-gradient(135deg, #7A2E2E 0%, #3A1F1A 100%)',
              }}
            >
              <div
                className="absolute inset-3 border border-[#EFE3CE]/40"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'><defs><pattern id='dots' width='4' height='4' patternUnits='userSpaceOnUse'><circle cx='2' cy='2' r='0.7' fill='%23EFE3CE' opacity='0.3'/></pattern></defs><rect width='100%25' height='100%25' fill='url(%23dots)'/></svg>\")",
                }}
              />
              <div className="absolute inset-0 grid place-items-center text-[#EFE3CE]/70 text-xs uppercase tracking-[0.4em]">
                Duotone Portrait
              </div>
              <div
                className="absolute top-2 left-2 right-2 h-6 border-2 border-[#EFE3CE]/40"
                style={{ borderBottom: 'none' }}
              />
            </div>
            <figcaption className="mt-2 text-xs uppercase tracking-[0.3em] opacity-70 text-center">
              Photographed for Al Aroussa
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Editorial event detail */}
      <section className="px-6 md:px-12 py-12 border-y-2 border-[#7A2E2E]">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-12 gap-10">
            <aside className="md:col-span-3 text-sm space-y-5 font-[Cormorant_Garamond]">
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-[#7A2E2E] mb-1">Date</div>
                <div className="text-xl">{formatDate(event.date)}</div>
              </div>
              <div className="border-t border-[#7A2E2E]/30 pt-4">
                <div className="text-[10px] uppercase tracking-[0.3em] text-[#7A2E2E] mb-1">Doors</div>
                <div className="text-xl">{formatTime(event.start_time)}</div>
              </div>
              <div className="border-t border-[#7A2E2E]/30 pt-4">
                <div className="text-[10px] uppercase tracking-[0.3em] text-[#7A2E2E] mb-1">Address</div>
                <div className="text-base leading-snug">{event.location}</div>
              </div>
              <div className="border-t border-[#7A2E2E]/30 pt-4">
                <div className="text-[10px] uppercase tracking-[0.3em] text-[#7A2E2E] mb-1">Capacity</div>
                <div className="text-xl">{event.capacity}</div>
              </div>
            </aside>
            <article className="md:col-span-9 font-[Cormorant_Garamond] text-[1.15rem] leading-[1.7] columns-1 md:columns-2 gap-10">
              <p className="first-letter:text-6xl first-letter:font-[DM_Serif_Display] first-letter:float-left first-letter:mr-2 first-letter:leading-none first-letter:text-[#7A2E2E]">
                {event.description} The doors open with the call to evening prayer next door
                drifting through the front window — a coincidence we plan around every spring.
              </p>
              <p className="mt-4">
                Inside: stripes on the back wall, a borrowed projector, a cake that has, against
                all odds, made it across the bridge intact. A bilingual room. A loud one.
              </p>
              <p className="mt-4 italic text-[#7A2E2E]">
                «احتفال أول سنة — كل من يحب القهوة الحلوة مدعو.»
              </p>
            </article>
          </div>
        </div>
      </section>

      <footer className="py-8 text-center text-[10px] uppercase tracking-[0.4em] text-[#7A2E2E]">
        كافيه كاظم · Brooklyn · Est. 2025
      </footer>
    </div>
  )
}
