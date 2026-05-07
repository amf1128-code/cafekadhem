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

// Same-tab navigation for both: on mobile, iOS/Android intercept the
// venmo:// scheme during navigation; on desktop, the browser just goes
// to venmo.com. Either way the user lands on Venmo, not on a receipt
// page telling them to look at another tab. The receipt is preserved
// in history (bfcache) for when they navigate back.
export function openPaymentLink(link: PaymentLink): void {
  window.location.href = link.url
}

export type { PaymentProvider, PaymentLink } from './types'
