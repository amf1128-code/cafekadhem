import type { PaymentProvider, PaymentLink } from './types'
import type { Order, Guest, Event } from '../types'

function isMobile(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

// Venmo enforces a ~280-char limit on the payment note. Stay just under
// that so reserved-character percent-encoding doesn't push us over once
// the URL is built.
const MAX_NOTE_LENGTH = 270

export interface VenmoNoteItem {
  name: string
  quantity: number
}

export interface BuildVenmoNoteInput {
  firstName: string
  eventTitle: string
  items?: VenmoNoteItem[]
}

function formatItem(item: VenmoNoteItem): string {
  return item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name
}

function pluralItems(n: number): string {
  return `${n} more item${n === 1 ? '' : 's'}`
}

// Build a Venmo note like "Anas - Persepolis Screening (Coffee x2, Knafeh
// and 3 more items)". Walks down from "all items fit" to fewer and fewer
// items until the result fits inside MAX_NOTE_LENGTH; if even the bare
// "(N items)" suffix won't fit, drops the parenthetical entirely.
export function buildVenmoNote({ firstName, eventTitle, items = [] }: BuildVenmoNoteInput): string {
  const base = `${firstName} - ${eventTitle}`
  if (items.length === 0) return base.slice(0, MAX_NOTE_LENGTH)

  const formatted = items.map(formatItem)

  for (let count = formatted.length; count >= 0; count--) {
    const remaining = formatted.length - count
    let suffix: string
    if (count === formatted.length) {
      suffix = `(${formatted.join(', ')})`
    } else if (count === 0) {
      suffix = `(${pluralItems(remaining)})`
    } else {
      suffix = `(${formatted.slice(0, count).join(', ')} and ${pluralItems(remaining)})`
    }
    const candidate = `${base} ${suffix}`
    if (candidate.length <= MAX_NOTE_LENGTH) return candidate
  }

  return base.slice(0, MAX_NOTE_LENGTH)
}

export const venmoProvider: PaymentProvider = {
  name: 'venmo',

  generatePaymentLink(order: Order, guest: Guest, event: Event, venmoHandle: string): PaymentLink {
    const amount = order.total?.toFixed(2) || '0.00'
    // Prefer the note already persisted on the order — call sites build
    // it with cart items in scope so the URL note matches the receipt
    // and what's stored in the DB. Fall back to a bare name+title if
    // it's missing (older rows, RSVP-only flows).
    const note = order.venmo_note || buildVenmoNote({
      firstName: guest.first_name,
      eventTitle: event.title,
    })
    const encodedNote = encodeURIComponent(note)

    if (isMobile()) {
      return {
        url: `venmo://paycharge?txn=pay&recipients=${venmoHandle}&amount=${amount}&note=${encodedNote}`,
        type: 'deep_link',
      }
    }

    return {
      url: `https://venmo.com/${venmoHandle}?txn=pay&amount=${amount}&note=${encodedNote}`,
      type: 'web_url',
    }
  },
}
