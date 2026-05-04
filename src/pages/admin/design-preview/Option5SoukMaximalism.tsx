import { Link } from 'react-router-dom'
import { useSampleEvent } from './sampleEvent'
import { formatDate, formatTime } from '../../../lib/utils/date'

/**
 * Option 5 — "Souk Maximalism"
 *
 * Hand-cut zine collage. Taped photos, paper grain, mixed typefaces,
 * stamps and stickers, halftones, ribbons. Most experimental of the five —
 * the "if Chahine cut this up at the kitchen table" version.
 */
export function Option5SoukMaximalism() {
  const { event } = useSampleEvent()

  return (
    <div
      className="min-h-screen text-[#1A1A1A] relative overflow-hidden"
      style={{
        backgroundColor: '#F5E9D2',
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='paper'><feTurbulence baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.55  0 0 0 0 0.4  0 0 0 0 0.2  0 0 0 0.18 0'/></filter><rect width='100%25' height='100%25' filter='url(%23paper)'/></svg>\")",
      }}
    >
      {/* Header zone */}
      <header className="relative px-6 md:px-12 pt-8">
        <div className="flex items-start justify-between gap-4">
          <div className="rotate-[-2deg]">
            <div
              className="font-[Amiri] text-[#C92121] leading-none"
              style={{ fontSize: 'clamp(48px, 8vw, 96px)' }}
            >
              كافيه كاظم
            </div>
            <div className="font-[Frijole] text-2xl text-[#1A21BC] mt-1">CAFE KADHEM</div>
          </div>
          <div className="rotate-[3deg] mt-4 hidden md:block">
            <Stamp text="Brooklyn · 2025" />
          </div>
        </div>
        <nav className="mt-6 flex flex-wrap gap-4 text-[11px] uppercase tracking-[0.3em] font-bold">
          <span className="bg-[#1A21BC] text-[#F5E9D2] px-3 py-1 rotate-[-1deg]">Events</span>
          <span className="bg-[#C92121] text-[#F5E9D2] px-3 py-1 rotate-[1deg]">Menu</span>
          <span className="bg-[#1A1A1A] text-[#F5E9D2] px-3 py-1 rotate-[-2deg]">Tickets</span>
          <span className="border-2 border-dashed border-[#1A1A1A] px-3 py-1 rotate-[1deg]">Visit</span>
          <span className="underline decoration-wavy decoration-[#C92121] px-3 py-1 rotate-[-1deg]">Press</span>
        </nav>
      </header>

      {/* Hero collage */}
      <section className="relative px-6 md:px-12 pt-16 pb-24">
        <div className="max-w-6xl mx-auto relative min-h-[600px]">
          {/* Background ribbon */}
          <div
            className="absolute -left-12 top-32 h-16 w-[120%] rotate-[-4deg] z-0"
            style={{
              background: '#C92121',
              backgroundImage:
                'repeating-linear-gradient(45deg, rgba(0,0,0,0.15) 0 6px, transparent 6px 12px)',
            }}
          />
          <div className="absolute right-0 top-0 w-40 h-40 rotate-[12deg] z-0 opacity-90"
            style={{
              backgroundImage: 'radial-gradient(circle, #1A21BC 30%, transparent 31%)',
              backgroundSize: '12px 12px',
            }}
          />

          {/* Massive title */}
          <h1
            className="relative z-10 leading-[0.85] mix-blend-multiply"
            style={{
              fontFamily: '"Bowlby One", "Frijole", serif',
              fontSize: 'clamp(80px, 16vw, 240px)',
              color: '#1A21BC',
              transform: 'rotate(-1deg)',
            }}
          >
            {event.title}
          </h1>

          {/* Taped photo card */}
          <div className="relative z-10 mt-[-40px] md:mt-[-80px] ml-auto md:ml-[40%] max-w-md rotate-[3deg]">
            <div
              className="absolute -top-5 left-1/3 w-20 h-7 bg-[#FFFCEC]/90 rotate-[-12deg] z-20"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
            />
            <div
              className="aspect-[4/3] bg-[#1A21BC] relative overflow-hidden"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'><defs><pattern id='dots' width='5' height='5' patternUnits='userSpaceOnUse'><circle cx='2.5' cy='2.5' r='1' fill='%23F5E9D2'/></pattern></defs><rect width='100%25' height='100%25' fill='%231A21BC'/><rect width='100%25' height='100%25' fill='url(%23dots)' opacity='0.4'/></svg>\")",
              }}
            >
              <div className="absolute inset-0 grid place-items-center text-[#F5E9D2]/70 text-xs uppercase tracking-[0.4em]">
                Halftone Photo
              </div>
            </div>
            <div className="bg-[#FFFCEC] px-3 py-2 text-xs italic font-[Cormorant_Garamond] border-x border-b border-[#1A1A1A]/30">
              The kid, the cake, the candle. May 2026.
            </div>
          </div>

          {/* Floating description note */}
          <div
            className="relative z-10 mt-12 max-w-sm rotate-[-2deg] bg-[#FFFCEC] p-5 border border-[#1A1A1A]/40"
            style={{ boxShadow: '4px 4px 0 #C92121' }}
          >
            <div className="font-[Frijole] text-xs text-[#C92121] uppercase mb-2">A note from the café</div>
            <p className="font-[Cormorant_Garamond] italic text-[1.05rem] leading-snug">
              {event.description}
            </p>
          </div>

          {/* Big stickers */}
          <div className="absolute right-4 bottom-12 z-10 rotate-[8deg]">
            <Stamp text={`${formatDate(event.date)}`} hue="#1A21BC" />
          </div>
          <div className="absolute left-1/3 top-2/3 z-10 rotate-[-12deg] hidden md:block">
            <Stamp text="Sold Out — Almost" hue="#C92121" />
          </div>
        </div>
      </section>

      {/* Event detail — receipt-style */}
      <section className="relative px-6 md:px-12 pb-20">
        <div
          className="max-w-2xl mx-auto bg-[#FFFCEC] p-8 border-2 border-dashed border-[#1A1A1A]/50 rotate-[-0.5deg]"
          style={{ boxShadow: '6px 6px 0 #1A21BC' }}
        >
          <div className="text-center font-[Frijole] text-xs uppercase tracking-[0.3em] text-[#C92121] mb-4">
            ··· Cafe Kadhem · Receipt of the Night ···
          </div>
          <div
            className="text-center font-[Bowlby_One] text-[#1A21BC] leading-none"
            style={{ fontSize: 'clamp(28px, 4vw, 44px)' }}
          >
            {event.title}
          </div>
          <div className="font-[Amiri] text-center text-2xl text-[#1A1A1A] mt-1">كافيه كاظم</div>

          <ul className="mt-6 font-[Cormorant_Garamond] text-base leading-7 border-t border-dashed border-[#1A1A1A]/40 pt-4">
            <Row label="Date" value={formatDate(event.date)} />
            <Row label="Doors" value={formatTime(event.start_time)} />
            <Row label="Where" value={event.location} />
            <Row label="Capacity" value={`${event.capacity ?? '—'} seats`} />
            <Row label="At the door" value={`$${(event.ticket_price ?? 0) / 100}`} />
          </ul>

          <Link
            to="#"
            className="mt-8 block text-center bg-[#C92121] text-[#FFFCEC] font-[Frijole] uppercase text-sm tracking-[0.3em] py-4 border-2 border-[#1A1A1A]"
            style={{ boxShadow: '4px 4px 0 #1A1A1A' }}
          >
            Stamp My Ticket →
          </Link>
        </div>
      </section>
    </div>
  )
}

function Stamp({ text, hue = '#1A1A1A' }: { text: string; hue?: string }) {
  return (
    <div
      className="inline-block font-[Frijole] uppercase text-xs tracking-[0.2em] px-3 py-2 border-2 rounded-sm"
      style={{
        color: hue,
        borderColor: hue,
        boxShadow: `inset 0 0 0 1px ${hue}33`,
      }}
    >
      {text}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between gap-4 border-b border-dotted border-[#1A1A1A]/30 py-1">
      <span className="uppercase tracking-[0.2em] text-xs text-[#C92121] self-center">{label}</span>
      <span className="text-right">{value}</span>
    </li>
  )
}
