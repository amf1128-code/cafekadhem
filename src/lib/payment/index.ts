import type { PaymentProvider } from './types'
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

export type { PaymentProvider, PaymentLink } from './types'
