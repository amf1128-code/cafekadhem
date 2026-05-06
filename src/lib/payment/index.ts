import type { PaymentLink, PaymentProvider } from './types'
import { venmoProvider } from './venmo'

const providers: Record<string, PaymentProvider> = {
  venmo: venmoProvider,
}

export function getPaymentProvider(method: string = 'venmo'): PaymentProvider {
  const provider = providers[method]
  if (!provider) {
    throw new Error(`Unknown payment provider: ${method}`)
  }
  return provider
}

// venmo:// only hands off to the app on mobile when the current tab
// navigates to it. window.open(_blank) opens a blank tab the OS can't
// intercept and the user just sees a blank page. Web URLs use a new
// tab so the cart/receipt stays put.
export function openPaymentLink(link: PaymentLink): void {
  if (link.type === 'deep_link') {
    window.location.href = link.url
  } else {
    window.open(link.url, '_blank', 'noopener,noreferrer')
  }
}

export type { PaymentProvider, PaymentLink } from './types'
