/**
 * Pure helpers used across the cinema landing + sibling pages. Kept
 * here (rather than inline in CinemaLanding.tsx) so they can be unit-
 * tested without spinning up React + Supabase.
 */

/**
 * Zips two lists so the output strictly alternates between them. If the
 * lists are uneven, the longer one's leftover entries get appended at
 * the end (acceptable for a marquee that loops).
 *
 *   interleaveAlternating(['a','b'], ['1','2','3']) → ['a','1','b','2','3']
 */
export function interleaveAlternating<T>(a: T[], b: T[]): T[] {
  const out: T[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

/**
 * Display the gathering number as a 3-digit padded string. Strips
 * leading "No." / "#" / "number" so an admin who types "No. 006" into
 * the gathering_number field doesn't render as "NO. No. 006" once the
 * cinema UI prepends its own "NO." label.
 */
export function padNo(
  n: string | number | null | undefined,
  fallback: string,
): string {
  if (n === null || n === undefined || n === '') return fallback
  const cleaned = String(n)
    .replace(/^\s*(no\.?|number|num\.?|#)\s*/i, '')
    .trim()
  if (!cleaned) return fallback
  return cleaned.length >= 3 ? cleaned : cleaned.padStart(3, '0')
}

/** "2026-06-16" → "06.16.26" — short cinema date stamp. */
export function formatCinemaDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  if (!y || !m || !d) return dateStr
  return `${m}.${d}.${y.slice(-2)}`
}

/**
 * "2026-06-16" → "06.16" — short date stamp without the year. Used on
 * event detail / ticket / calendar / my-tickets rows where the year is
 * implied. Falls back to the raw string if it isn't an ISO date.
 */
export function formatShortDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return m && d ? `${m}.${d}` : dateStr
}

/**
 * "18:00" → "6PM" — single time, hour-only. Null/empty → "". Used for
 * pickup slots and event start times where the end time isn't shown.
 */
export function formatHour(t: string | null | undefined): string {
  if (!t) return ''
  const hour = Number(t.split(':')[0])
  const period = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 || 12
  return `${display}${period}`
}

/** "2026-06-16" → "TUE" — three-letter weekday in ET. */
export function formatCinemaDay(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return date
    .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })
    .toUpperCase()
}

/**
 * "18:00", "21:30" → "6PM – 9PM"
 * "18:00", null    → "6PM TILL LATE"
 */
export function formatCinemaTime(start: string, end: string | null): string {
  const startHour = Number(start.split(':')[0])
  const period = startHour >= 12 ? 'PM' : 'AM'
  const display = startHour % 12 || 12
  if (!end) return `${display}${period} TILL LATE`
  const endHour = Number(end.split(':')[0])
  const endPeriod = endHour >= 12 ? 'PM' : 'AM'
  const endDisplay = endHour % 12 || 12
  return `${display}${period} – ${endDisplay}${endPeriod}`
}

/**
 * Split text into bullet items. Accepts either explicit newlines (one
 * bullet per line, optionally led by a list marker) or a paragraph of
 * sentences separated by terminators. Cap of 4 items.
 */
export function splitBullets(text: string | null): string[] {
  if (!text) return []
  const byLine = text
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-•·*]\s*/, ''))
    .filter(Boolean)
  if (byLine.length > 1) return byLine.slice(0, 4)
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 4)
}

/**
 * Heuristic line-break for hero titles: titles longer than ~14 chars
 * get split into two lines at the nearest word boundary past the
 * midpoint. Matches the designer's "WORLD CUP / WATCH PARTY" treatment.
 */
export function makeDisplayTitle(title: string): string {
  const clean = title.toUpperCase().trim()
  if (clean.length <= 14 || clean.includes('\n')) return clean
  const mid = Math.floor(clean.length / 2)
  const after = clean.indexOf(' ', mid)
  const before = clean.lastIndexOf(' ', mid)
  const breakAt =
    after === -1
      ? before
      : before === -1
        ? after
        : after - mid <= mid - before
          ? after
          : before
  if (breakAt <= 0) return clean
  return clean.slice(0, breakAt) + '\n' + clean.slice(breakAt + 1)
}

/**
 * Aggregate plus-one counts by host RSVP id. Used by event detail to
 * collapse "Alice + Bob (her +1)" into a single "Alice +1" display.
 *
 * Input rows are RSVP rows (any with a `plus_one_of` column). Plus-one
 * rows have `plus_one_of` set to the host's RSVP id; host rows have it
 * null. Returns a Map of host id → number of plus-ones.
 */
export function buildPlusOneCount<T extends { id: string; plus_one_of: string | null }>(
  rsvps: T[],
): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rsvps) {
    if (r.plus_one_of) {
      map.set(r.plus_one_of, (map.get(r.plus_one_of) ?? 0) + 1)
    }
  }
  return map
}
