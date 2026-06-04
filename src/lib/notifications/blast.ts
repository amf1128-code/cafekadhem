import { supabase } from '../supabase'

// Audiences a notification blast can target. Keep this union — and the
// status/payment maps below — in sync with:
//   - the notification_blasts.audience CHECK (migration 056)
//   - STATUSES_FOR_AUDIENCE / PAYMENT_STATUSES_FOR_AUDIENCE in the
//     send-blast edge function (which actually resolves recipients).
export type BlastAudience =
  | 'yes_only'
  | 'yes_and_maybe'
  | 'all_invited'
  | 'unpaid_tickets'
  | 'maybes'
  | 'payment_unconfirmed'

// RSVP statuses each audience includes.
export const AUDIENCE_STATUSES: Record<BlastAudience, string[]> = {
  yes_only: ['yes'],
  yes_and_maybe: ['yes', 'maybe'],
  all_invited: ['yes', 'maybe', 'no', 'waitlisted'],
  // "Hasn't paid": the new flow's registered-but-unpaid (pending_payment)
  // plus grandfathered going-but-unpaid 'yes' rows. The payment narrowing
  // below restricts to payment_status 'unpaid'.
  unpaid_tickets: ['pending_payment', 'yes'],
  maybes: ['maybe'],
  // Self-attested payment ('yes'), still awaiting host confirmation —
  // narrowed to payment_status 'pending' below.
  payment_unconfirmed: ['yes'],
}

// Audiences that additionally filter on payment_status. Absent = no
// payment filter (any payment_status is fine).
export const AUDIENCE_PAYMENT_STATUSES: Partial<Record<BlastAudience, string[]>> = {
  // Only payment_status 'unpaid'. 'pending' is excluded — under the new
  // flow a 'pending' guest has self-attested payment and counts as going,
  // so a "you haven't paid" nudge would be wrong. 'paid'/'refunded' too.
  unpaid_tickets: ['unpaid'],
  // They clicked "I've paid" but the host hasn't matched the Venmo yet.
  payment_unconfirmed: ['pending'],
}

export interface CreateBlastInput {
  eventId: string
  audience: BlastAudience
  emailSubject: string
  emailBody: string
  smsBody: string
}

export interface BlastResult {
  sent: number
  failed: number
}

// Insert a notification_blasts row, then invoke the send-blast edge
// function to deliver it. The edge function resolves recipients from the
// audience, fans out to SMS/email per guest preference, dedups, and
// honours the sms_enabled gate — so callers only supply the message.
//
// Shared by the Blast composer (custom copy) and the one-click
// reminder/nudge actions on the Tickets page (prebuilt copy). Both paths
// produce a row that shows up in the event's blast history.
export async function createAndSendBlast(input: CreateBlastInput): Promise<BlastResult> {
  const { data: created, error: insertErr } = await supabase
    .from('notification_blasts')
    .insert({
      event_id: input.eventId,
      audience: input.audience,
      email_subject: input.emailSubject,
      email_body: input.emailBody,
      sms_body: input.smsBody,
    })
    .select('id')
    .single()
  if (insertErr || !created) throw insertErr || new Error('Failed to create blast')

  const { data: result, error: invokeErr } = await supabase.functions.invoke('send-blast', {
    body: { blast_id: created.id },
  })
  if (invokeErr) throw invokeErr

  const r = result as { sent?: number; failed?: number } | null
  return { sent: r?.sent ?? 0, failed: r?.failed ?? 0 }
}

// ---- Message templates (admin-editable copy) ---------------------------
// Reminder / nudge copy lives in the message_templates table so the admin
// can edit it from the dashboard. Placeholders: {name} {event} {amount}.

export interface MessageVars {
  name: string
  event: string
  amount: string
}

export function renderTemplate(text: string, vars: MessageVars): string {
  return text
    .replace(/\{name\}/g, vars.name)
    .replace(/\{event\}/g, vars.event)
    .replace(/\{amount\}/g, vars.amount)
}

export async function fetchMessageTemplate(
  key: string,
): Promise<{ subject: string; email_body: string; sms_body: string } | null> {
  const { data } = await supabase
    .from('message_templates')
    .select('subject, email_body, sms_body')
    .eq('key', key)
    .maybeSingle()
  return (data as { subject: string; email_body: string; sms_body: string } | null) ?? null
}
