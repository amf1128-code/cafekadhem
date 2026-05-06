// ============================================================
// webhook-sms — Telnyx inbound webhook for STOP / HELP / START.
//
// 10DLC compliance requires us to honor STOP. Telnyx auto-blocks the
// number on their side but we must also flip our side to
// notification_preference='none' so we never try to re-send via that
// channel (and so admin's audit trail reflects the unsubscribe).
//
// Also handles HELP (auto-reply with a help line) and START / UNSTOP
// (re-subscribe, sets preference back to 'sms').
//
// Signature verification uses Telnyx ed25519 webhook signing. The
// public key is set as TELNYX_PUBLIC_KEY in the edge function env.
// Until it's configured, the function rejects all requests as a
// safety default — no anonymous unsubscribes possible.
//
// USER_FLOWS_SPEC.md §7 + §11 action item 12.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const TELNYX_PUBLIC_KEY = Deno.env.get('TELNYX_PUBLIC_KEY') || ''
const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY') || ''
const TELNYX_FROM_NUMBER = Deno.env.get('TELNYX_FROM_NUMBER') || ''
const TELNYX_MESSAGING_PROFILE_ID = Deno.env.get('TELNYX_MESSAGING_PROFILE_ID') || ''

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

const STOP_WORDS = ['stop', 'unsubscribe', 'cancel', 'end', 'quit', 'stopall']
const HELP_WORDS = ['help', 'info']
const START_WORDS = ['start', 'unstop', 'subscribe', 'yes']

// Telnyx signs the body with ed25519 using:
//   message = `${telnyx-timestamp}|${rawBody}`
//   signature = base64(ed25519-sign(message, telnyx_private_key))
// We verify with the matching public key. Reject:
//   - missing signature/timestamp headers
//   - timestamp > 300s old (replay)
//   - signature doesn't verify
async function verifyTelnyxSignature(
  rawBody: string,
  signatureB64: string | null,
  timestamp: string | null,
): Promise<boolean> {
  if (!signatureB64 || !timestamp || !TELNYX_PUBLIC_KEY) return false

  const ts = parseInt(timestamp, 10)
  if (!Number.isFinite(ts)) return false
  const ageSec = Math.abs(Date.now() / 1000 - ts)
  if (ageSec > 300) return false

  try {
    const publicKeyBytes = decodeBase64(TELNYX_PUBLIC_KEY)
    const key = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const message = new TextEncoder().encode(`${timestamp}|${rawBody}`)
    const signature = decodeBase64(signatureB64)
    return await crypto.subtle.verify('Ed25519', key, signature, message)
  } catch (err) {
    console.error('telnyx signature verify failed:', err)
    return false
  }
}

async function sendTelnyxReply(to: string, text: string): Promise<void> {
  if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) return
  try {
    await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TELNYX_API_KEY}`,
      },
      body: JSON.stringify({
        from: TELNYX_FROM_NUMBER,
        to,
        text,
        messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
      }),
    })
  } catch (err) {
    console.error('telnyx reply send failed:', err)
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('telnyx-signature-ed25519')
  const timestamp = req.headers.get('telnyx-timestamp')

  if (!(await verifyTelnyxSignature(rawBody, signature, timestamp))) {
    return new Response('invalid signature', { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  // Telnyx posts message events nested under data.payload.
  const eventType: string = payload?.data?.event_type ?? ''
  if (eventType !== 'message.received') {
    return new Response('ok', { status: 200 })
  }

  const text: string = String(payload?.data?.payload?.text ?? '').trim().toLowerCase()
  const fromPhone: string | undefined = payload?.data?.payload?.from?.phone_number

  if (!fromPhone) return new Response('ok', { status: 200 })

  const { data: guest } = await supabase
    .from('guests')
    .select('id')
    .eq('phone', fromPhone)
    .maybeSingle()

  // No matching guest — still 200 (don't leak existence).
  if (!guest) return new Response('ok', { status: 200 })

  if (STOP_WORDS.includes(text)) {
    await supabase.rpc('record_unsubscribe', {
      p_guest_id: guest.id,
      p_channel: 'sms',
      p_source: 'telnyx_stop',
      p_payload: payload,
    })
    // Telnyx auto-replies with the standard STOP confirmation; nothing to send.
    return new Response('ok', { status: 200 })
  }

  if (HELP_WORDS.includes(text)) {
    await sendTelnyxReply(
      fromPhone,
      'Cafe Kadhem: questions? cafekadhem.com — reply STOP to opt out.',
    )
    return new Response('ok', { status: 200 })
  }

  if (START_WORDS.includes(text)) {
    await supabase
      .from('guests')
      .update({ notification_preference: 'sms', updated_at: new Date().toISOString() })
      .eq('id', guest.id)
    await sendTelnyxReply(
      fromPhone,
      "Cafe Kadhem: you're back on the list. Reply STOP to opt out.",
    )
    return new Response('ok', { status: 200 })
  }

  return new Response('ok', { status: 200 })
})
