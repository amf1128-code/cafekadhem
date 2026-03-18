import type { PaymentProvider, PaymentLink } from './types'
import type { Order, Guest, Event } from '../types'

function isMobile(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

export const venmoProvider: PaymentProvider = {
  name: 'venmo',

  generatePaymentLink(order: Order, guest: Guest, event: Event, venmoHandle: string): PaymentLink {
    const amount = order.total?.toFixed(2) || '0.00'
    const note = `${guest.first_name} - ${event.title}`
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
