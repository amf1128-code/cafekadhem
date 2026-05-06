/**
 * Helper for dispatching the merge_verification notification when
 * upsert_guest returns a pending_merge payload (USER_FLOWS_SPEC.md §3.4 Case B).
 *
 * The verification_token is minted server-side by upsert_guest; this helper
 * just forwards it to send-notification, which renders the link and dispatches
 * via the channel that owns the matched row.
 *
 * Fire-and-forget: failures are logged but never rethrown so the calling
 * action (RSVP, order, pickup, invite) succeeds even if the verification
 * notification fails to send.
 */

import { supabase } from '../supabase'

export type PendingMerge = {
  from: string
  to: string
  channel: 'email' | 'sms'
  verification_token: string
}

export async function dispatchMergeVerification(
  pendingMerge: PendingMerge,
): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('send-notification', {
      body: {
        guestId: pendingMerge.to,
        type: 'merge_verification',
        data: {
          verification_token: pendingMerge.verification_token,
          channel: pendingMerge.channel,
        },
      },
    })
    if (error) {
      console.error('merge_verification send failed:', error.message)
    }
  } catch (err) {
    console.error('merge_verification send threw:', err)
  }
}
