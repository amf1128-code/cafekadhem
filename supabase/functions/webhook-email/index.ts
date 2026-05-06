// ============================================================
// webhook-email — Resend webhook for email events.
//
// Primary purpose: catch `email.unsubscribed` events (Resend's "list
// unsubscribe" header support / one-click unsubscribe) and flip the
// guest's notification_preference to 'none'.
//
// Resend signs webhooks via Svix. We verify HMAC-SHA256 over
// `${svix-id}.${svix-timestamp}.${rawBody}` using the secret from
// the Resend dashboard, base64-encoded.
//
// Until RESEND_WEBHOOK_SECRET is configured the function rejects all
// requests as a safety default.
//
// USER_FLOWS_SPEC.md §7 + §11 action item 12.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const RESEND_WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') || ''

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

// Svix secret format: "whsec_<base64>" — strip the prefix before decoding.
function getSvixSecretBytes(): Uint8Array | null {
  if (!RESEND_WEBHOOK_SECRET) return null
  const stripped = RESEND_WEBHOOK_SECRET.replace(/^whsec_/, '')
  try {
    return decodeBase64(stripped)
  } catch {
    return null
  }
}

async function verifySvixSignature(
  rawBody: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
): Promise<boolean> {
  if (!svixId || !svixTimestamp || !svixSignature) return false
  const secretBytes = getSvixSecretBytes()
  if (!secretBytes) return false

  // Replay protection: reject if timestamp > 5 minutes old.
  const ts = parseInt(svixTimestamp, 10)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false

  const message = `${svixId}.${svixTimestamp}.${rawBody}`
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)),
  )
  // Encode without using Buffer (not available in Deno) or std/base64 import
  // beyond what we already have.
  let binary = ''
  for (let i = 0; i < sigBytes.length; i++) binary += String.fromCharCode(sigBytes[i])
  const expected = `v1,${btoa(binary)}`

  // svix-signature header is space-separated list of "v1,<sig>" entries.
  const presented = svixSignature.split(' ').map((s) => s.trim())
  return presented.includes(expected)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  const rawBody = await req.text()
  const svixId = req.headers.get('svix-id')
  const svixTs = req.headers.get('svix-timestamp')
  const svixSig = req.headers.get('svix-signature')

  if (!(await verifySvixSignature(rawBody, svixId, svixTs, svixSig))) {
    return new Response('invalid signature', { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  if (payload?.type !== 'email.unsubscribed' && payload?.type !== 'contact.unsubscribed') {
    return new Response('ok', { status: 200 })
  }

  // Resend webhook bodies vary; the email is in data.to[] for transactional
  // unsubscribes. Be lenient about field shape.
  const candidates: string[] = []
  if (Array.isArray(payload?.data?.to)) {
    for (const v of payload.data.to) {
      if (typeof v === 'string') candidates.push(v.toLowerCase())
    }
  }
  if (typeof payload?.data?.email === 'string') {
    candidates.push(payload.data.email.toLowerCase())
  }

  if (candidates.length === 0) return new Response('ok', { status: 200 })

  // Try each candidate. Stop at the first match.
  for (const email of candidates) {
    const { data: guest } = await supabase
      .from('guests')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (guest) {
      await supabase.rpc('record_unsubscribe', {
        p_guest_id: guest.id,
        p_channel: 'email',
        p_source: 'resend_unsubscribe',
        p_payload: payload,
      })
      break
    }
  }

  return new Response('ok', { status: 200 })
})
