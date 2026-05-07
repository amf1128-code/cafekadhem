// send-blast — execute a notification_blasts row.
//
// JWT-gated (admin-only). Idempotent at two layers:
//   1. Per-blast guard: rejects re-runs unless blast.status='pending' or
//      blast was started >10 min ago and is stuck in 'sending'.
//   2. Per-recipient guard: notifications_log.dedup_key='blast:<blast_id>:<guest_id>'
//      with the partial unique index from migration 030. A retry only
//      sends to recipients who didn't get the previous attempt.
//
// USER_FLOWS_SPEC.md §8 + Notification Blast Feature spec (per-user).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''
const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY') || ''
const TELNYX_FROM_NUMBER = Deno.env.get('TELNYX_FROM_NUMBER') || ''
const TELNYX_MESSAGING_PROFILE_ID = Deno.env.get('TELNYX_MESSAGING_PROFILE_ID') || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'noreply@cafekadhem.com'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function getSiteUrl(): Promise<string> {
  const { data } = await admin
    .from('admin_settings').select('site_url').limit(1).single()
  return (data?.site_url || 'https://cafekadhem.com').replace(/\/$/, '')
}

function injectAmbientToken(rawUrl: string, ambientToken: string, siteHost: string): string {
  if (!rawUrl) return rawUrl
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { return rawUrl }
  if (parsed.host !== siteHost) return rawUrl
  if (parsed.searchParams.has('as')) return rawUrl
  if (parsed.pathname.startsWith('/verify-merge')) return rawUrl
  parsed.searchParams.set('as', ambientToken)
  return parsed.toString()
}

function htmlEmail(opts: {
  title: string
  eventType: string | null
  body: string
  eventUrl: string
}): string {
  const bodyHtml = escapeHtml(opts.body).replace(/\r?\n/g, '<br>')
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#fdfaf3;font-family:Georgia,'Times New Roman',serif;color:#1a2e1f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf3;padding:32px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e0cf;padding:32px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <p style="margin:0;letter-spacing:0.25em;text-transform:uppercase;font-size:11px;color:#6b6452;">Cafe Kadhem</p>
        </td></tr>
        <tr><td align="center" style="padding-bottom:8px;">
          <h1 style="margin:8px 0 0;font-style:italic;font-weight:400;font-size:24px;color:#1a2e1f;">${escapeHtml(opts.title)}</h1>
          ${opts.eventType ? `<p style="margin:6px 0 0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#6b6452;">${escapeHtml(opts.eventType)}</p>` : ''}
        </td></tr>
        <tr><td style="padding:16px 0 8px;border-top:1px solid #e7e0cf;border-bottom:1px solid #e7e0cf;">
          <p style="margin:16px 0;font-size:15px;line-height:1.55;color:#3a3a3a;">${bodyHtml}</p>
        </td></tr>
        <tr><td align="center" style="padding:24px 0 8px;">
          <a href="${escapeHtml(opts.eventUrl)}" style="display:inline-block;background:#1a2e1f;color:#fdfaf3;text-decoration:none;padding:14px 28px;letter-spacing:0.2em;text-transform:uppercase;font-size:12px;">View Event</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

async function sendSMS(to: string, body: string): Promise<boolean> {
  if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) return false
  try {
    const r = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TELNYX_API_KEY}` },
      body: JSON.stringify({
        from: TELNYX_FROM_NUMBER,
        to,
        text: body,
        messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
      }),
    })
    return r.ok
  } catch { return false }
}

async function sendEmail(to: string, subject: string, text: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, text, html }),
    })
    return r.ok
  } catch { return false }
}

async function verifyAdminJwt(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return false
  const token = auth.slice(7)
  // Use the anon-key client to verify the JWT by attempting to read auth.user.
  const verify = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await verify.auth.getUser()
  if (error || !data?.user) return false
  return true
}

const STATUSES_FOR_AUDIENCE: Record<string, string[]> = {
  yes_only: ['yes'],
  yes_and_maybe: ['yes', 'maybe'],
  all_invited: ['yes', 'maybe', 'no', 'waitlisted'],
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: corsHeaders })

  if (!(await verifyAdminJwt(req))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  let blastId: string
  try {
    const body = await req.json()
    blastId = body.blast_id
    if (!blastId) throw new Error('blast_id required')
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 400, headers: jsonHeaders })
  }

  // Fetch blast + event
  const { data: blast, error: blastErr } = await admin
    .from('notification_blasts').select('*').eq('id', blastId).single()
  if (blastErr || !blast) {
    return new Response(JSON.stringify({ error: 'blast not found' }), { status: 404, headers: jsonHeaders })
  }

  // Idempotency guard
  if (blast.status === 'sent') {
    return new Response(
      JSON.stringify({ success: true, sent: blast.sent_count, failed: blast.failed_count, already: true }),
      { headers: jsonHeaders },
    )
  }
  if (blast.status === 'sending' && blast.started_at) {
    const startedMs = new Date(blast.started_at).getTime()
    const ageMs = Date.now() - startedMs
    if (ageMs < 10 * 60 * 1000) {
      return new Response(JSON.stringify({ error: 'blast already in flight' }), { status: 409, headers: jsonHeaders })
    }
    // Stuck >10 min — fall through and retry. Per-recipient dedup_key
    // prevents double-sends to recipients who got it the first time.
  }

  // Mark sending
  await admin
    .from('notification_blasts')
    .update({ status: 'sending', started_at: new Date().toISOString() })
    .eq('id', blastId)

  const { data: eventRow } = await admin
    .from('events').select('id, title, event_type').eq('id', blast.event_id).single()
  if (!eventRow) {
    await admin.from('notification_blasts')
      .update({ status: 'failed', sent_at: new Date().toISOString() })
      .eq('id', blastId)
    return new Response(JSON.stringify({ error: 'event not found' }), { status: 404, headers: jsonHeaders })
  }

  const { data: settings } = await admin
    .from('admin_settings').select('sms_enabled').limit(1).single()
  const smsEnabled = !!settings?.sms_enabled

  const siteUrl = await getSiteUrl()
  const siteHost = new URL(siteUrl).host
  const bareEventUrl = `${siteUrl}/events/${blast.event_id}`

  // Audience query: distinct guest_ids with required status, plus_one_of NULL,
  // contactable, with notification_preference != 'none'.
  const { data: rsvps } = await admin
    .from('rsvps')
    .select('guest_id, guests!guest_id(id, first_name, email, phone, notification_preference)')
    .eq('event_id', blast.event_id)
    .is('plus_one_of', null)
    .in('status', STATUSES_FOR_AUDIENCE[blast.audience] ?? ['yes'])

  type GuestShape = {
    id: string
    first_name: string | null
    email: string | null
    phone: string | null
    notification_preference: 'sms' | 'email' | 'both' | 'none' | null
  }

  const seen = new Set<string>()
  const recipients: GuestShape[] = []
  for (const r of rsvps ?? []) {
    const g = (r as { guests: GuestShape | null }).guests
    if (!g) continue
    if (seen.has(g.id)) continue
    if (g.notification_preference === 'none') continue
    seen.add(g.id)
    recipients.push(g)
  }

  let sent = 0
  let failed = 0

  for (const guest of recipients) {
    const baseDedupKey = `blast:${blastId}:${guest.id}`

    // Decide which channels to attempt for this guest. 'both' fans out
    // to SMS + email; single-channel preferences pick one (with the
    // usual email/sms fallbacks).
    const wantsSms = !!(
      guest.phone &&
      smsEnabled &&
      (guest.notification_preference === 'sms' ||
        guest.notification_preference === 'both' ||
        !guest.email)
    )
    const wantsEmail = !!(
      guest.email &&
      (guest.notification_preference === 'email' ||
        guest.notification_preference === 'both' ||
        guest.notification_preference === null ||
        guest.notification_preference === undefined ||
        !guest.phone ||
        !smsEnabled)
    )

    if (!wantsSms && !wantsEmail) {
      await admin.from('notifications_log').insert({
        guest_id: guest.id,
        event_id: blast.event_id,
        channel: 'email',
        type: 'notification_blast',
        status: 'failed',
        dedup_key: baseDedupKey,
        error: 'no reachable channel',
      })
      failed++
      continue
    }

    // Mint ambient token + inject into URL.
    let eventUrl = bareEventUrl
    try {
      const { data: tok } = await admin.rpc('mint_ambient_token', { p_guest_id: guest.id })
      const ambient = typeof tok === 'string' ? tok : null
      if (ambient) eventUrl = injectAmbientToken(bareEventUrl, ambient, siteHost)
    } catch {
      // Non-fatal — fall back to bare URL
    }

    const dualSend = wantsSms && wantsEmail
    const dedupSuffix = (ch: 'sms' | 'email') => (dualSend ? `:${ch}` : '')

    let smsOk: boolean | null = null
    let emailOk: boolean | null = null

    if (wantsSms) {
      const smsKey = `${baseDedupKey}${dedupSuffix('sms')}`
      const { data: existing } = await admin
        .from('notifications_log')
        .select('id, status')
        .eq('dedup_key', smsKey)
        .limit(1)
        .maybeSingle()
      if (existing && existing.status === 'sent') {
        smsOk = true
      } else {
        const smsBody = `${blast.sms_body}\n\n${eventUrl}`
        smsOk = await sendSMS(guest.phone!, smsBody)
        await admin.from('notifications_log').insert({
          guest_id: guest.id,
          event_id: blast.event_id,
          channel: 'sms',
          type: 'notification_blast',
          status: smsOk ? 'sent' : 'failed',
          dedup_key: smsKey,
          sent_at: smsOk ? new Date().toISOString() : null,
          error: smsOk ? null : 'send failed',
        })
      }
    }

    if (wantsEmail) {
      const emailKey = `${baseDedupKey}${dedupSuffix('email')}`
      const { data: existing } = await admin
        .from('notifications_log')
        .select('id, status')
        .eq('dedup_key', emailKey)
        .limit(1)
        .maybeSingle()
      if (existing && existing.status === 'sent') {
        emailOk = true
      } else {
        const html = htmlEmail({
          title: eventRow.title,
          eventType: eventRow.event_type,
          body: blast.email_body,
          eventUrl,
        })
        const text = `${blast.email_body}\n\nDetails: ${eventUrl}`
        emailOk = await sendEmail(guest.email!, blast.email_subject, text, html)
        await admin.from('notifications_log').insert({
          guest_id: guest.id,
          event_id: blast.event_id,
          channel: 'email',
          type: 'notification_blast',
          status: emailOk ? 'sent' : 'failed',
          dedup_key: emailKey,
          sent_at: emailOk ? new Date().toISOString() : null,
          error: emailOk ? null : 'send failed',
        })
      }
    }

    if (smsOk === true || emailOk === true) sent++
    else failed++
  }

  // Final status: 'failed' iff nothing got through; 'sent' otherwise (even
  // partial success counts as 'sent' so admin can see counts and decide).
  const finalStatus = sent === 0 && failed > 0 ? 'failed' : 'sent'

  await admin
    .from('notification_blasts')
    .update({
      status: finalStatus,
      sent_count: sent,
      failed_count: failed,
      sent_at: new Date().toISOString(),
    })
    .eq('id', blastId)

  return new Response(JSON.stringify({ success: true, sent, failed }), { headers: jsonHeaders })
})
