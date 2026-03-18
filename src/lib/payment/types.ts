import type { Order, Guest, Event } from '../types'

export interface PaymentLink {
  url: string
  type: 'deep_link' | 'web_url'
}

export interface PaymentUpdate {
  orderId: string
  status: 'confirmed' | 'paid' | 'cancelled'
}

export interface PaymentStatus {
  orderId: string
  status: string
  paid: boolean
}

export interface PaymentProvider {
  name: string
  generatePaymentLink(order: Order, guest: Guest, event: Event, venmoHandle: string): PaymentLink
  handleWebhook?(payload: unknown): Promise<PaymentUpdate>
  getPaymentStatus?(orderId: string): Promise<PaymentStatus>
}
