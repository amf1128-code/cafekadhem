import { supabase } from '../supabase'
import type { NotificationPayload, NotificationResult } from './types'

/**
 * Send a notification via Supabase Edge Function.
 * The Edge Function handles routing (SMS vs email) based on guest preference.
 */
export async function sendNotification(payload: NotificationPayload): Promise<NotificationResult> {
  try {
    const { data, error } = await supabase.functions.invoke('send-notification', {
      body: payload,
    })

    if (error) {
      console.error('Notification error:', error)
      return { success: false, channel: 'email', error: error.message }
    }

    return data as NotificationResult
  } catch (err) {
    console.error('Notification error:', err)
    return {
      success: false,
      channel: 'email',
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Send an invite notification via Edge Function.
 */
export async function sendInviteNotification(
  eventId: string,
  contactInfo: { email?: string; phone?: string },
  inviteToken: string,
  invitedByName?: string
): Promise<NotificationResult> {
  try {
    const { data, error } = await supabase.functions.invoke('send-invite', {
      body: { eventId, contactInfo, inviteToken, invitedByName },
    })

    if (error) {
      return { success: false, channel: 'email', error: error.message }
    }

    return data as NotificationResult
  } catch (err) {
    return {
      success: false,
      channel: 'email',
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

export type { NotificationPayload, NotificationResult } from './types'
