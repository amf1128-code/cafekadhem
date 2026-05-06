// Issues a magic link for "find my tickets". Always returns success
// regardless of whether the contact matched a guest, so the endpoint
// can't be used to enumerate phone numbers / emails.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY') || ''
const TELNYX_MESSAGING_PROFILE_ID = Deno.env.get('TELNYX_MESSAGING_PROFILE_ID') || ''
const TELNYX_FROM_NUMBER = Deno.env.get('TELNYX_FROM_NUMBER') || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'noreply@cafekadhem.com'
const SITE_URL = Deno.env.get('SITE_URL') || 'https://cafekadhem.com'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
)

const rateLimits = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now()
  const entry = rateLimits.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + 60000 })
    return true
  }
  if (entry.count >= maxPerMinute) return false
  entry.count++
  return true
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!checkRateLimit(`lookup:${ip}`, 5)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429,
      headers: jsonHeaders,
    })
  }

  try {
    const { email, phone } = await req.json()

    const trimmedEmail = typeof email === 'string' ? email.trim() : ''
    const trimmedPhone = typeof phone === 'string' ? phone.trim() : ''

    if (!trimmedEmail && !trimmedPhone) {
      return new Response(JSON.stringify({ error: 'Email or phone required' }), {
        status: 400,
        headers: jsonHeaders,
      })
    }

    const channel: 'sms' | 'email' = trimmedEmail ? 'email' : 'sms'

    const { data: guestId } = await supabase.rpc('find_guest_by_contact', {
      p_email: trimmedEmail || null,
      p_phone: trimmedPhone || null,
    })

    // Always respond success — don't leak whether the contact matched.
    if (!guestId) {
      return new Response(JSON.stringify({ success: true, channel }), { headers: jsonHeaders })
    }

    const token = randomToken()
    const tokenHash = await sha256Hex(token)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const { error: insertErr } = await supabase.from('magic_links').insert({
      guest_id: guestId,
      token_hash: tokenHash,
      channel,
      expires_at: expiresAt,
    })
    if (insertErr) throw insertErr

    const link = `${SITE_URL}/my-tickets?t=${token}`
    const smsMessage = `Your Cafe Kadhem magic link (expires in 24h). Tap to see your RSVPs, tickets, and pickup orders — no password needed: ${link}`
    const emailSubject = 'Your Cafe Kadhem magic link'
    const emailText = `Tap the link below to see all your RSVPs, tickets, and pickup orders. No password needed.\n\n${link}\n\nThis link works for 24 hours. If you didn't request it, you can ignore this email.`
    const emailHtml = `<!doctype html>
<html><body style="margin:0;padding:0;background:#fdfaf3;font-family:Georgia,'Times New Roman',serif;color:#1a2e1f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf3;padding:32px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e0cf;padding:32px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <p style="margin:0;letter-spacing:0.25em;text-transform:uppercase;font-size:11px;color:#6b6452;">Cafe Kadhem</p>
        </td></tr>
        <tr><td align="center" style="padding-bottom:24px;">
          <h1 style="margin:8px 0 0;font-style:italic;font-weight:400;font-size:24px;color:#1a2e1f;">Your magic link</h1>
        </td></tr>
        <tr><td align="center" style="padding:8px 0 16px;">
          <p style="margin:0;font-size:15px;line-height:1.5;color:#3a3a3a;">Tap below to see all your RSVPs, tickets, and pickup orders. No password needed.</p>
        </td></tr>
        <tr><td align="center" style="padding:16px 0 8px;">
          <a href="${link}" style="display:inline-block;background:#1a2e1f;color:#fdfaf3;text-decoration:none;padding:14px 28px;letter-spacing:0.2em;text-transform:uppercase;font-size:12px;">Open my stuff</a>
        </td></tr>
        <tr><td align="center" style="padding:16px 0 0;">
          <p style="margin:0;font-size:12px;color:#6b6452;">This link works for 24 hours. If you didn't request it, you can ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

    let sent = false
    if (channel === 'sms' && TELNYX_API_KEY) {
      const r = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
        },
        body: JSON.stringify({
          from: TELNYX_FROM_NUMBER,
          to: trimmedPhone,
          text: smsMessage,
          messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
        }),
      })
      sent = r.ok
    } else if (channel === 'email' && RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [trimmedEmail],
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
        }),
      })
      sent = r.ok
    }

    await supabase.from('notifications_log').insert({
      guest_id: guestId,
      channel,
      type: 'ticket_lookup',
      status: sent ? 'sent' : 'failed',
      sent_at: sent ? new Date().toISOString() : null,
    })

    return new Response(JSON.stringify({ success: true, channel }), { headers: jsonHeaders })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
})
