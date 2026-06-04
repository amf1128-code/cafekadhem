export interface NotificationPayload {
  guestId: string
  eventId?: string
  type:
    | 'rsvp_confirmation'
    | 'order_confirmation'
    | 'pickup_order_confirmation'
    | 'event_update'
    | 'event_reminder'
    | 'invite'
    | 'waitlist_promoted'
    | 'ticket_issued'
    | 'payment_reminder'
    | 'maybe_nudge'
    | 'payment_unconfirmed'
  data?: Record<string, string>
}

export interface NotificationResult {
  success: boolean
  channel: 'sms' | 'email'
  error?: string
}
