import { Link } from 'react-router-dom'

type Option = {
  slug: string
  title: string
  arabic: string
  tagline: string
  palette: string[]
  type: string
  vibe: string
}

const OPTIONS: Option[] = [
  {
    slug: 'option-1',
    title: '01 — Birthday Poster',
    arabic: 'عيد ميلاد',
    tagline: 'Direct lift of the green/pink stripe poster.',
    palette: ['#E8DFC8', '#B6CDC0', '#1A21BC'],
    type: 'Anton + Amiri',
    vibe: 'Vertical-stripe page, ultramarine condensed display, Arabic above Latin, B&W cutout photography. Stack-first, almost zine.',
  },
  {
    slug: 'option-2',
    title: '02 — Al Aroussa',
    arabic: 'العروسة',
    tagline: 'Vintage Egyptian magazine cover.',
    palette: ['#EFE3CE', '#7A2E2E', '#3A1F1A'],
    type: 'DM Serif Display + Cormorant + Amiri',
    vibe: 'Cream paper grain, sepia/duotone images, ornate Arabic + slab Latin, narrow editorial column with ruled lines. Dense, layered, magazine-cover energy.',
  },
  {
    slug: 'option-3',
    title: '03 — Magasin Général',
    arabic: 'المتجر',
    tagline: 'The souk reference, stretched into a homepage.',
    palette: ['#FFFFFF', '#C92121', '#1A21BC'],
    type: 'DM Serif + Anton + Amiri (red wordmark)',
    vibe: 'Bold red Arabic logo dominates the header, all-caps Latin nav. Hero is a surreal collage — flyer floating in front of architectural fragments. Asymmetric grid.',
  },
  {
    slug: 'option-4',
    title: '04 — Groovy Showroom',
    arabic: 'كرنفال',
    tagline: 'The 70s exhibition mockup, dialed up.',
    palette: ['#F2C94C', '#E94B6E', '#7A3F9A', '#1B2057'],
    type: 'Bowlby One + Lobster + Shrikhand',
    vibe: 'Psychedelic floral/swoosh background, cream card on top, navy chunky display heads, big bordered CTA buttons, stamp-style decorative blocks.',
  },
  {
    slug: 'option-5',
    title: '05 — Souk Maximalism',
    arabic: 'كولاج',
    tagline: 'Hand-cut zine collage. Loud.',
    palette: ['#F5E9D2', '#1A21BC', '#C92121', '#FFFCEC'],
    type: 'Frijole + Bowlby One + Amiri + Cormorant',
    vibe: 'Taped photos, paper grain, mixed typefaces, stamps and stickers. The "if Chahine cut this up at the kitchen table" version.',
  },
]

export function DesignPreviewIndex() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-2xl text-forest-dark">Design Previews</h1>
        <p className="mt-2 text-sm text-ink/70 max-w-2xl">
          Five static design directions for the bold-retro-pastiche brief
          (<code className="text-xs">design-inspo/2026-05-04-bold-retro-pastiche</code>). Each
          renders a hero + event detail using your most recent published event (or a sample if
          there isn't one yet). Browse, then tell Claude which to take to a full restyle.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {OPTIONS.map(opt => (
          <Link
            key={opt.slug}
            to={opt.slug}
            target="_blank"
            className="block bg-white border border-warm rounded-lg p-5 hover:border-forest-dark transition"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <h2 className="font-serif text-lg text-forest-dark">{opt.title}</h2>
              <span className="font-[Amiri] text-xl text-forest leading-none">{opt.arabic}</span>
            </div>
            <p className="text-sm text-ink/80 mb-3 italic">{opt.tagline}</p>
            <p className="text-sm text-ink/70 mb-4 leading-relaxed">{opt.vibe}</p>

            <div className="flex items-center gap-3 mb-3">
              <span className="text-[10px] uppercase tracking-[0.2em] text-ink/50 w-14">Palette</span>
              <div className="flex gap-1.5">
                {opt.palette.map(c => (
                  <span
                    key={c}
                    className="inline-block w-6 h-6 rounded border border-black/10"
                    style={{ background: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-[0.2em] text-ink/50 w-14">Type</span>
              <span className="text-xs text-ink/70">{opt.type}</span>
            </div>

            <div className="mt-4 text-xs text-forest-dark uppercase tracking-[0.2em]">
              Open preview →
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-10 text-sm text-ink/60 max-w-2xl border-t border-warm pt-6">
        Like one? Just say <em>"go with option 3"</em> and Claude will take it to a full
        site-wide restyle on a fresh <code className="text-xs">design/&lt;name&gt;</code> branch
        so the current site stays untouched until you merge.
      </div>
    </div>
  )
}
