export interface NotificationPayload {
  guestId: string
  eventId: string
  type:
    | 'rsvp_confirmation'
    | 'order_confirmation'
    | 'event_update'
    | 'event_reminder'
    | 'invite'
    | 'waitlist_promoted'
    | 'ticket_issued'
  data?: Record<string, string>
}

export interface NotificationResult {
  success: boolean
  channel: 'sms' | 'email'
  error?: string
}
