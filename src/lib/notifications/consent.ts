/**
 * Centralized consent copy for public forms (10DLC compliance).
 *
 * Rendered as fine print directly under the submit button on every
 * form that captures contact info. Visible at the moment of submission,
 * never behind a modal. USER_FLOWS_SPEC.md §7.1.
 */

export type ConsentVerb = 'rsvp' | 'order' | 'invite' | 'pickup'

const VERB_PHRASE: Record<ConsentVerb, string> = {
  rsvp: 'By RSVPing',
  order: 'By placing your order',
  invite: 'By inviting a friend',
  pickup: 'By placing a pickup order',
}

export function consentNoteText(verb: ConsentVerb): string {
  return `${VERB_PHRASE[verb]}, you agree to receive SMS and/or email from Cafe Kadhem for event invites, reminders, tickets, and order updates. Reply STOP to opt out of SMS at any time.`
}
