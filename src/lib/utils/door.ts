import type { RSVP, Guest } from '../types'

export type AttendeeRow = RSVP & { guest: Guest }

// Pull a ticket token out of whatever the scanner/paste box yields — a
// full https://.../ticket/<token> URL or the bare hex token. Returns null
// for anything that isn't a plausible token so we never call the RPC with
// garbage.
export function tokenFromValue(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    const parts = u.pathname.split('/').filter(Boolean)
    const i = parts.indexOf('ticket')
    if (i >= 0 && parts[i + 1]) return parts[i + 1]
  } catch {
    /* not a URL */
  }
  if (/^[a-f0-9]{16,64}$/i.test(trimmed)) return trimmed
  return null
}

// A link to the host's Venmo profile, used to generate a fallback QR at
// the door when no QR image has been uploaded. Scanning it with a phone
// camera opens the host's Venmo. Leading "@" is tolerated and stripped.
export function venmoProfileUrl(handle: string): string {
  const clean = handle.trim().replace(/^@/, '')
  return `https://venmo.com/${clean}`
}

// "Needs to pay" at the door: the new-flow registered-but-unpaid state, or
// a going-but-unpaid row. 'pending' (self-attested) and 'paid' don't.
// Plus-ones never pay separately — the host covers them — so they're never
// flagged regardless of their own row's payment_status.
export function needsPayment(row: AttendeeRow): boolean {
  if (row.plus_one_of) return false
  if (row.payment_status === 'paid' || row.payment_status === 'pending') return false
  return row.status === 'pending_payment' || row.status === 'yes'
}

// Who shows in the default door list (no active search): anyone plausibly
// walking through the door — going, registered-unpaid, waitlisted, or
// already checked in. Declined / maybe are hidden by default but still
// findable via search (see attendeeMatchesSearch).
export function isAttendingEligible(row: AttendeeRow): boolean {
  if (row.checked_in_at) return true
  return (
    row.status === 'yes' ||
    row.status === 'pending_payment' ||
    row.status === 'waitlisted'
  )
}

function fullName(row: AttendeeRow): string {
  return `${row.guest.first_name || ''} ${row.guest.last_name || ''}`.trim()
}

// Free-text match across name, email, and phone so the door can find
// someone fast however they're remembered. Empty query matches nothing
// here (callers use isAttendingEligible for the default view instead).
export function attendeeMatchesSearch(row: AttendeeRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  const haystack = [
    fullName(row),
    row.guest.email || '',
    row.guest.phone || '',
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

// Door sort: not-yet-checked-in first (the line you're working), then
// alphabetical by name so a given person is easy to scan for.
export function compareAttendees(a: AttendeeRow, b: AttendeeRow): number {
  const aIn = a.checked_in_at ? 1 : 0
  const bIn = b.checked_in_at ? 1 : 0
  if (aIn !== bIn) return aIn - bIn
  return fullName(a).localeCompare(fullName(b))
}

// The rows to display given the current search box. When searching we
// match across *every* row (so a guest who RSVPed "no" but showed up is
// still findable); otherwise we show the attending-eligible set.
export function visibleAttendees(rows: AttendeeRow[], query: string): AttendeeRow[] {
  const q = query.trim()
  const base = q
    ? rows.filter(r => attendeeMatchesSearch(r, q))
    : rows.filter(isAttendingEligible)
  return [...base].sort(compareAttendees)
}
