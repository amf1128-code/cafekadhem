import { Link } from 'react-router-dom'

/**
 * /admin/jaya-preview — visual mockup page for the coming-soon Jaya
 * sticker. Renders four placement variants and four style variants on
 * the actual cinema row markup, so the operator can pick a placement
 * + a style before merging the branch to prod.
 *
 * Tell Claude e.g. "go with placement B + style 3" and we ship that.
 */

type StyleId = 'pill-sun' | 'tape' | 'round-stamp' | 'cobalt-pill' | 'ink-bar'

interface PlacementVariant {
  letter: string
  label: string
  blurb: string
  position: React.CSSProperties
  cornerPeel?: boolean
  size?: 'normal' | 'large'
}

const PLACEMENTS: PlacementVariant[] = [
  {
    letter: 'A',
    label: 'A — Centered, right edge',
    blurb:
      'Sits over the date stack, vertically centered. Subtle, partially overlapping the time text. (This is what the current branch ships.)',
    position: { top: '50%', right: 12, transform: 'translateY(-50%)' },
  },
  {
    letter: 'B',
    label: 'B — Big slap, bridging columns',
    blurb:
      'Bigger sticker, harder rotation, parked on the boundary between title and date columns. Stamp-slammed-on-the-row energy.',
    position: { top: '50%', right: '38%', transform: 'translateY(-50%)' },
    size: 'large',
  },
  {
    letter: 'C',
    label: 'C — Corner peel (bottom-right, off the edge)',
    blurb:
      'Bottom-right corner; sticker bottom hangs off the row border. Half-peeled, breaks the row baseline.',
    position: { bottom: -10, right: 24 },
    cornerPeel: true,
  },
  {
    letter: 'D',
    label: 'D — Top-pinned, hovering above',
    blurb:
      'Top-right corner pinned above the row border so it floats over the cell above. Most aggressive — definitely a sticker.',
    position: { top: -10, right: 22 },
    cornerPeel: true,
  },
]

interface StyleVariant {
  id: StyleId
  number: string
  label: string
  blurb: string
}

const STYLES: StyleVariant[] = [
  {
    id: 'pill-sun',
    number: '1',
    label: '1 — Sun pill (current)',
    blurb:
      'Rakkas Arabic + mono caps, sun-yellow pill, ink border, hard 2px shadow, -10° rotation. Lifted directly from the Cursor Sticker spec.',
  },
  {
    id: 'tape',
    number: '2',
    label: '2 — Masking tape strip',
    blurb:
      'Square corners, slight rotation, no drop shadow. Reads as a strip of tape applied to the row instead of a dome sticker.',
  },
  {
    id: 'round-stamp',
    number: '3',
    label: '3 — Round stamp',
    blurb:
      'Circular badge in the same family as the hero price seal. Stacks جاية over "Coming soon" inside a ring, ink on cobalt.',
  },
  {
    id: 'cobalt-pill',
    number: '4',
    label: '4 — Cobalt pill, cream type',
    blurb:
      'Same pill geometry as #1 but inverted to cobalt blue with cream type. Cooler, less attention-grabbing than the sun version.',
  },
  {
    id: 'ink-bar',
    number: '5',
    label: '5 — Ink bar, sun shadow',
    blurb:
      'Ink-black rectangle, cream Latin + sun-orange Arabic, with a sun-yellow drop shadow instead of black. Reads like a stamped programme leaflet.',
  },
]

export function JayaPreviewPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-2xl text-forest-dark">
          Jaya sticker — placement + style options
        </h1>
        <p className="mt-2 text-sm text-ink/70 max-w-2xl">
          Two stacks of mockups using the actual cinema row markup, so what
          you see is what ships. Pick a <strong>placement</strong> (where
          the sticker goes) and a <strong>style</strong> (what it looks
          like), then tell Claude{' '}
          <em>"go with placement B + style 3"</em>.
        </p>
        <p className="mt-2 text-sm text-ink/70 max-w-2xl">
          To compare against the live home page (an event in coming-soon
          mode shows up under "On the books"), open{' '}
          <Link to="/" target="_blank" className="underline text-forest-dark">
            the landing page
          </Link>
          .
        </p>
      </div>

      <section className="mb-12">
        <div className="mb-4">
          <h2 className="font-serif text-xl text-forest-dark">Placement</h2>
          <p className="text-sm text-ink/70 max-w-2xl">
            All four cards use style #1 (sun pill) so you're only comparing
            where the sticker sits.
          </p>
        </div>
        <div className="space-y-8">
          {PLACEMENTS.map(p => (
            <div
              key={p.letter}
              className="bg-white border border-warm rounded-lg p-6"
            >
              <div className="mb-3">
                <h3 className="font-serif text-lg text-forest-dark">
                  {p.label}
                </h3>
                <p className="text-sm text-ink/70 mt-1 max-w-2xl leading-relaxed">
                  {p.blurb}
                </p>
              </div>
              <SampleRow placement={p} styleId="pill-sun" />
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="font-serif text-xl text-forest-dark">Style</h2>
          <p className="text-sm text-ink/70 max-w-2xl">
            All four cards use placement A (centered right) so you're only
            comparing the sticker treatment itself.
          </p>
        </div>
        <div className="space-y-8">
          {STYLES.map(s => (
            <div
              key={s.id}
              className="bg-white border border-warm rounded-lg p-6"
            >
              <div className="mb-3">
                <h3 className="font-serif text-lg text-forest-dark">
                  {s.label}
                </h3>
                <p className="text-sm text-ink/70 mt-1 max-w-2xl leading-relaxed">
                  {s.blurb}
                </p>
              </div>
              <SampleRow placement={PLACEMENTS[0]} styleId={s.id} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

/** Replica of CinemaLanding's small CalendarRow with the sticker layered
 *  on per the chosen placement + style. Wraps in `cinema-root` so the
 *  cinema CSS variables resolve. */
function SampleRow({
  placement,
  styleId,
}: {
  placement: PlacementVariant
  styleId: StyleId
}) {
  return (
    <div className="cinema-root">
      <div
        style={{
          border: '2px solid var(--ck-ink)',
          background: 'var(--ck-cream)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 16,
            alignItems: 'center',
            padding: '18px 22px',
            background: 'var(--ck-cream)',
            color: 'var(--ck-ink)',
            position: 'relative',
            // The corner-peel placements need to render past the border;
            // the others stay clipped so the row reads tidy.
            overflow: placement.cornerPeel ? 'visible' : 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--ck-serif)',
                fontWeight: 800,
                fontSize: 24,
                lineHeight: 1,
              }}
            >
              World Cup Watch Party
            </span>
            <span
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 22,
                direction: 'rtl',
                color: 'var(--ck-cobalt)',
              }}
            >
              كأس العالم
            </span>
          </div>

          <div
            style={{
              textAlign: 'right',
              fontFamily: 'var(--ck-mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              lineHeight: 1.5,
            }}
          >
            TUE 06.16
            <br />
            <span style={{ opacity: 0.65 }}>6PM – 11PM</span>
          </div>

          <span
            style={{
              position: 'absolute',
              ...placement.position,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            <Sticker styleId={styleId} large={placement.size === 'large'} />
          </span>
        </div>
      </div>
    </div>
  )
}

/** The five sticker styles. Each owns its visual chrome (shape, color,
 *  rotation, shadow) but renders the same content (جاية + Coming soon).
 *  The round stamp stacks the bilingual content vertically; everything
 *  else lays it out horizontally. */
function Sticker({
  styleId,
  large,
}: {
  styleId: StyleId
  large: boolean
}) {
  if (styleId === 'round-stamp') {
    return (
      <span
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: 88,
          height: 88,
          border: '2px solid var(--ck-cream)',
          borderRadius: '50%',
          background: 'var(--ck-cobalt)',
          color: 'var(--ck-cream)',
          boxShadow: '2px 2px 0 var(--ck-ink)',
          transform: 'rotate(-8deg)',
          textAlign: 'center',
          padding: 6,
          lineHeight: 1,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--ck-arabic-display)',
            fontSize: 28,
            direction: 'rtl',
            color: 'var(--ck-sun)',
            lineHeight: 1,
          }}
        >
          جاية
        </span>
        <span
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: 8,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            marginTop: 4,
            fontWeight: 700,
          }}
        >
          Coming soon
        </span>
      </span>
    )
  }

  if (styleId === 'tape') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: large ? '7px 16px' : '6px 14px',
          border: '2px solid var(--ck-ink)',
          background: 'var(--ck-sun)',
          color: 'var(--ck-ink)',
          // Square corners, no shadow — reads like a strip of tape
          // pressed onto the row instead of a domed sticker.
          borderRadius: 0,
          transform: `rotate(${large ? -4 : -3}deg)`,
          transformOrigin: 'center',
          whiteSpace: 'nowrap',
          lineHeight: 1,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--ck-arabic-display)',
            fontSize: large ? 24 : 19,
            direction: 'rtl',
            letterSpacing: 0,
            lineHeight: 1,
          }}
        >
          جاية
        </span>
        <span
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: large ? 11 : 9,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}
        >
          Coming soon
        </span>
      </span>
    )
  }

  if (styleId === 'cobalt-pill') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: large ? 9 : 7,
          padding: large ? '7px 16px' : '5px 12px',
          border: '2px solid var(--ck-ink)',
          background: 'var(--ck-cobalt)',
          color: 'var(--ck-cream)',
          borderRadius: 999,
          boxShadow: large ? '3px 3px 0 var(--ck-ink)' : '2px 2px 0 var(--ck-ink)',
          transform: `rotate(${large ? -12 : -10}deg)`,
          transformOrigin: 'center',
          whiteSpace: 'nowrap',
          lineHeight: 1,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--ck-arabic-display)',
            fontSize: large ? 24 : 19,
            direction: 'rtl',
            color: 'var(--ck-sun)',
            letterSpacing: 0,
            lineHeight: 1,
          }}
        >
          جاية
        </span>
        <span
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: large ? 11 : 9,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}
        >
          Coming soon
        </span>
      </span>
    )
  }

  if (styleId === 'ink-bar') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: large ? '8px 18px' : '6px 14px',
          background: 'var(--ck-ink)',
          color: 'var(--ck-cream)',
          border: '2px solid var(--ck-ink)',
          borderRadius: 0,
          transform: `rotate(${large ? -5 : -4}deg)`,
          transformOrigin: 'center',
          whiteSpace: 'nowrap',
          lineHeight: 1,
          boxShadow: '2px 2px 0 var(--ck-sun)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--ck-arabic-display)',
            fontSize: large ? 24 : 19,
            direction: 'rtl',
            color: 'var(--ck-sun)',
            letterSpacing: 0,
            lineHeight: 1,
          }}
        >
          جاية
        </span>
        <span
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: large ? 11 : 9,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}
        >
          Coming soon
        </span>
      </span>
    )
  }

  // pill-sun (default — current production look)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: large ? 9 : 7,
        padding: large ? '7px 16px' : '5px 12px',
        border: '2px solid var(--ck-ink)',
        background: 'var(--ck-sun)',
        color: 'var(--ck-ink)',
        borderRadius: 999,
        boxShadow: large ? '3px 3px 0 var(--ck-ink)' : '2px 2px 0 var(--ck-ink)',
        transform: `rotate(${large ? -12 : -10}deg)`,
        transformOrigin: 'center',
        whiteSpace: 'nowrap',
        lineHeight: 1,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--ck-arabic-display)',
          fontSize: large ? 24 : 19,
          direction: 'rtl',
          letterSpacing: 0,
          lineHeight: 1,
        }}
      >
        جاية
      </span>
      <span
        style={{
          fontFamily: 'var(--ck-mono)',
          fontSize: large ? 11 : 9,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}
      >
        Coming soon
      </span>
    </span>
  )
}
