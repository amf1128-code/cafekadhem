import { Link } from 'react-router-dom'
import { useSampleEvent } from './sampleEvent'
import { formatDate, formatTime } from '../../../lib/utils/date'

/**
 * Option 4 — "Groovy Showroom"
 *
 * Direct off the 70s vintage exhibition mockup. Psychedelic floral / swoosh
 * background, cream card sits on top, navy chunky display heads, big bordered
 * CTA buttons, stamp-style decorative blocks. Whimsy maxed out.
 */
export function Option4GroovyShowroom() {
  const { event } = useSampleEvent()

  return (
    <div className="min-h-screen relative overflow-hidden font-[Lobster]">
      {/* Psychedelic backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background: '#F2C94C',
        }}
      >
        <svg
          className="absolute inset-0 w-full h-full opacity-90"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 800 600"
        >
          {/* Big swooshes */}
          <path d="M -50 100 C 200 -50, 400 250, 850 50 L 850 0 L -50 0 Z" fill="#7A3F9A" />
          <path d="M -50 540 C 250 720, 600 380, 850 600 L 850 700 L -50 700 Z" fill="#E94B6E" />
          <path d="M -50 300 C 200 200, 400 420, 850 300" stroke="#F58A2E" strokeWidth="40" fill="none" opacity="0.7" />
          {/* Flowers */}
          {Array.from({ length: 12 }).map((_, i) => (
            <Flower key={i} cx={(i * 73) % 800} cy={((i * 113) % 540) + 30} hue={['#E94B6E', '#7A3F9A', '#F58A2E', '#F2C94C', '#3FB6A8'][i % 5]} />
          ))}
          {/* Stars */}
          {Array.from({ length: 20 }).map((_, i) => (
            <text key={`star-${i}`} x={(i * 41) % 800} y={((i * 67) % 580) + 12} fontSize="20" fill="#1B2057" opacity="0.7">★</text>
          ))}
        </svg>
      </div>

      {/* Card */}
      <div className="relative max-w-5xl mx-auto px-6 py-12 md:py-20">
        <div
          className="bg-[#FBE7BE] border-2 border-[#1B2057] p-8 md:p-12 relative"
          style={{
            boxShadow: '8px 8px 0 #1B2057',
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence baseFrequency='0.7' numOctaves='2'/><feColorMatrix values='0 0 0 0 0.7  0 0 0 0 0.55  0 0 0 0 0.3  0 0 0 0.06 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
          }}
        >
          {/* Card header */}
          <div className="flex items-center justify-between mb-10 pb-4 border-b border-[#1B2057]/30">
            <div className="flex items-center gap-3">
              <span className="text-[#F58A2E] text-3xl">✦</span>
              <span
                className="text-[#1B2057] text-2xl"
                style={{ fontFamily: '"Lobster", "Shrikhand", cursive' }}
              >
                Cafe&nbsp;Kadhem
              </span>
            </div>
            <nav className="hidden md:flex gap-8 text-[#1B2057] uppercase font-[Inter] text-xs tracking-[0.25em] font-semibold">
              <a href="#" className="border-b-2 border-[#F58A2E]">Home</a>
              <a href="#">Blog</a>
              <a href="#">Tickets</a>
              <a href="#">Contacts</a>
            </nav>
            <Link
              to="#"
              className="hidden md:inline-block px-5 py-2 bg-[#F58A2E] text-[#FBE7BE] text-xs uppercase tracking-[0.2em] font-[Inter] font-bold border-2 border-[#1B2057]"
              style={{ boxShadow: '3px 3px 0 #1B2057' }}
            >
              Sign In
            </Link>
          </div>

          {/* Hero */}
          <div className="grid md:grid-cols-12 gap-8 items-center">
            <div className="md:col-span-7">
              <div className="font-[Amiri] text-3xl text-[#1B2057] mb-2">كافيه كاظم</div>
              <h1
                className="text-[#1B2057] leading-[0.95]"
                style={{
                  fontFamily: '"Bowlby One", "Lobster", serif',
                  fontSize: 'clamp(56px, 9vw, 120px)',
                }}
              >
                {event.title}
              </h1>
              <p className="mt-5 font-[Inter] text-[#5A2E1A] text-base uppercase tracking-wider leading-relaxed max-w-md">
                {event.description}
              </p>
              <div className="mt-8 flex gap-4 flex-wrap">
                <Link
                  to="#"
                  className="inline-block px-7 py-3 bg-[#F58A2E] text-[#FBE7BE] font-[Inter] text-sm tracking-[0.2em] uppercase font-bold border-2 border-[#1B2057]"
                  style={{ boxShadow: '5px 5px 0 #1B2057' }}
                >
                  Buy Tickets
                </Link>
                <Link
                  to="#"
                  className="inline-block px-7 py-3 bg-[#FBE7BE] text-[#1B2057] font-[Inter] text-sm tracking-[0.2em] uppercase font-bold border-2 border-[#1B2057]"
                  style={{ boxShadow: '5px 5px 0 #E94B6E' }}
                >
                  See the menu
                </Link>
              </div>
            </div>
            <div className="md:col-span-5 relative">
              {/* Stamp-style block */}
              <div
                className="aspect-[4/5] relative grid place-items-center text-center p-6"
                style={{
                  background:
                    'repeating-linear-gradient(45deg, #E94B6E 0 30px, #F58A2E 30px 60px, #F2C94C 60px 90px, #3FB6A8 90px 120px, #7A3F9A 120px 150px)',
                  border: '4px solid #1B2057',
                  boxShadow: '6px 6px 0 #1B2057',
                }}
              >
                <div className="bg-[#FBE7BE] border-4 border-[#1B2057] p-6 w-[85%]">
                  <div className="text-[#1B2057] text-[10px] tracking-[0.4em] uppercase font-[Inter] font-bold">
                    The Birthday
                  </div>
                  <div
                    className="text-[#E94B6E] mt-2 leading-[0.9]"
                    style={{
                      fontFamily: '"Shrikhand", "Lobster", cursive',
                      fontSize: 'clamp(40px, 5vw, 64px)',
                    }}
                  >
                    First Year
                  </div>
                  <div className="font-[Amiri] text-2xl text-[#1B2057] mt-1">عيد ميلاد</div>
                  <div className="mt-4 border-t border-[#1B2057] pt-3 text-[10px] tracking-[0.3em] uppercase font-[Inter] text-[#1B2057]">
                    {formatDate(event.date)}
                    <br />
                    {formatTime(event.start_time)} · ${(event.ticket_price ?? 0) / 100}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Event detail card */}
        <div
          className="mt-10 bg-[#FBE7BE] border-2 border-[#1B2057] p-8 md:p-12"
          style={{ boxShadow: '8px 8px 0 #E94B6E' }}
        >
          <div className="grid md:grid-cols-3 gap-8 font-[Inter]">
            <div>
              <div className="text-[10px] tracking-[0.4em] uppercase text-[#1B2057] font-bold mb-2">When</div>
              <div
                className="text-[#1B2057]"
                style={{ fontFamily: '"Bowlby One", serif', fontSize: '32px', lineHeight: 1 }}
              >
                {formatDate(event.date)}
              </div>
              <div className="text-[#5A2E1A] text-sm mt-2">{formatTime(event.start_time)} → late</div>
            </div>
            <div>
              <div className="text-[10px] tracking-[0.4em] uppercase text-[#1B2057] font-bold mb-2">Where</div>
              <div
                className="text-[#1B2057]"
                style={{ fontFamily: '"Bowlby One", serif', fontSize: '32px', lineHeight: 1 }}
              >
                {event.location_name ?? 'Brooklyn'}
              </div>
              <div className="text-[#5A2E1A] text-sm mt-2">{event.location}</div>
            </div>
            <div>
              <div className="text-[10px] tracking-[0.4em] uppercase text-[#1B2057] font-bold mb-2">Door</div>
              <div
                className="text-[#E94B6E]"
                style={{ fontFamily: '"Bowlby One", serif', fontSize: '32px', lineHeight: 1 }}
              >
                ${(event.ticket_price ?? 0) / 100}
              </div>
              <div className="text-[#5A2E1A] text-sm mt-2">{event.capacity} seats — first come</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Flower({ cx, cy, hue }: { cx: number; cy: number; hue: string }) {
  return (
    <g transform={`translate(${cx} ${cy})`} opacity="0.85">
      {[0, 60, 120, 180, 240, 300].map(deg => (
        <ellipse
          key={deg}
          rx="10"
          ry="20"
          cx="0"
          cy="-12"
          fill={hue}
          transform={`rotate(${deg})`}
        />
      ))}
      <circle r="6" fill="#FBE7BE" />
    </g>
  )
}
