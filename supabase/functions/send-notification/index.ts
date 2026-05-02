import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import QRCode from 'https://esm.sh/qrcode@1.5.3'

const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY') || ''
const TELNYX_MESSAGING_PROFILE_ID = Deno.env.get('TELNYX_MESSAGING_PROFILE_ID') || ''
const TELNYX_FROM_NUMBER = Deno.env.get('TELNYX_FROM_NUMBER') || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'noreply@cafekadhem.com'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
)

// Rate limiting: simple in-memory store
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function getSiteUrl(): Promise<string> {
  const { data } = await supabase
    .from('admin_settings')
    .select('site_url')
    .limit(1)
    .single()
  return (data?.site_url || 'https://cafekadhem.com').replace(/\/$/, '')
}

async function generateAndUploadQr(token: string, encodedUrl: string): Promise<string | null> {
  try {
    const dataUrl: string = await QRCode.toDataURL(encodedUrl, {
      width: 600,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#1a2e1f', light: '#fdfaf3' },
    })
    const base64 = dataUrl.split(',')[1]
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

    const { error } = await supabase.storage
      .from('tickets')
      .upload(`${token}.png`, bytes, {
        contentType: 'image/png',
        upsert: true,
      })
    if (error) {
      console.error('QR upload failed:', error.message)
      return null
    }

    const { data } = supabase.storage.from('tickets').getPublicUrl(`${token}.png`)
    return data.publicUrl
  } catch (err) {
    console.error('QR generation failed:', err)
    return null
  }
}

const messageTemplates: Record<string, (data: Record<string, string>) => { subject: string; body: string; html?: string }> = {
  rsvp_confirmation: (data) => {
    if (data.is_ticketed === 'true' && data.status === 'yes') {
      return {
        subject: `We got your RSVP - ${data.event_title || 'Cafe Kadhem'}`,
        body: `We got your RSVP! Make sure your ticket payment went through, and you'll receive a follow up with your ticket within 48 hours!`,
      }
    }
    return {
      subject: `RSVP Confirmed - ${data.event_title || 'Cafe Kadhem'}`,
      body: `Thanks for your RSVP! You're ${data.status === 'yes' ? 'going' : 'on the maybe list'} for ${data.event_title || 'our event'}. We look forward to seeing you!`,
    }
  },
  order_confirmation: (data) => ({
    subject: `Order Confirmed - ${data.event_title || 'Cafe Kadhem'}`,
    body: `Your pre-order for ${data.event_title || 'our event'} has been submitted. Your host will confirm payment once received via Venmo.`,
  }),
  event_update: (data) => ({
    subject: `Event Update - ${data.event_title || 'Cafe Kadhem'}`,
    body: `There's been an update to ${data.event_title || 'an event'} you RSVP'd to. Check the event page for the latest details.`,
  }),
  event_reminder: (data) => ({
    subject: `Reminder - ${data.event_title || 'Cafe Kadhem'} Tomorrow!`,
    body: `Reminder: ${data.event_title || 'Your event'} is tomorrow! See you there.`,
  }),
  waitlist_promoted: (data) => ({
    subject: `You're In! - ${data.event_title || 'Cafe Kadhem'}`,
    body: `Great news! A spot opened up at ${data.event_title || 'our event'} and you've been promoted from the waitlist. You're confirmed! See you there.`,
  }),
  ticket_issued: (data) => {
    const eventTitle = data.event_title || 'Cafe Kadhem'
    const ticketUrl = data.ticket_url || ''
    const qrImageUrl = data.qr_image_url || ''
    const text = `You're confirmed for ${eventTitle}.\n\nShow this at the door for entry: ${ticketUrl}\n\nIf the QR isn't visible in this email, open the link above.`
    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#fdfaf3;font-family:Georgia,'Times New Roman',serif;color:#1a2e1f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf3;padding:32px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e0cf;padding:32px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <p style="margin:0;letter-spacing:0.25em;text-transform:uppercase;font-size:11px;color:#6b6452;">Cafe Kadhem</p>
        </td></tr>
        <tr><td align="center" style="padding-bottom:24px;">
          <h1 style="margin:8px 0 0;font-style:italic;font-weight:400;font-size:24px;color:#1a2e1f;">${escapeHtml(eventTitle)}</h1>
        </td></tr>
        <tr><td align="center" style="padding:16px 0 8px;border-top:1px solid #e7e0cf;">
          <p style="margin:0;font-size:14px;color:#3a3a3a;">You're confirmed. Show this QR at the door:</p>
        </td></tr>
        <tr><td align="center" style="padding:16px 0;">
          ${qrImageUrl ? `<img src="${escapeHtml(qrImageUrl)}" alt="Ticket QR code" width="280" height="280" style="display:block;border:1px solid #e7e0cf;background:#fdfaf3;" />` : ''}
        </td></tr>
        <tr><td align="center" style="padding-top:16px;border-top:1px solid #e7e0cf;">
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.15em;text-transform:uppercase;color:#6b6452;">Or view your ticket online</p>
          <p style="margin:0;font-size:14px;"><a href="${escapeHtml(ticketUrl)}" style="color:#1a2e1f;">${escapeHtml(ticketUrl)}</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
    return {
      subject: `Your ticket - ${eventTitle}`,
      body: text,
      html,
    }
  },
}

async function sendSMS(to: string, body: string): Promise<boolean> {
  if (!TELNYX_API_KEY) {
    console.error('TELNYX_API_KEY not configured')
    return false
  }

  const response = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
    },
    body: JSON.stringify({
      from: TELNYX_FROM_NUMBER,
      to,
      text: body,
      messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
    }),
  })

  return response.ok
}

async function sendEmail(to: string, subject: string, body: string, html?: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured')
    return false
  }

  const payload: Record<string, unknown> = {
    from: FROM_EMAIL,
    to: [to],
    subject,
    text: body,
  }
  if (html) payload.html = html

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    console.error('Resend send failed:', response.status, errText)
  }
  return response.ok
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  // Rate limit by IP
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!checkRateLimit(`notif:${ip}`, 10)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429,
      headers: jsonHeaders,
    })
  }

  try {
    const { guestId, eventId, type, data = {} } = await req.json()

    // Get guest info
    const { data: guest } = await supabase
      .from('guests')
      .select('*')
      .eq('id', guestId)
      .single()

    if (!guest) {
      return new Response(JSON.stringify({ success: false, error: 'Guest not found' }), {
        status: 404,
        headers: jsonHeaders,
      })
    }

    // Get event info for message templates
    if (eventId) {
      const { data: event } = await supabase
        .from('events')
        .select('title')
        .eq('id', eventId)
        .single()
      if (event) data.event_title = event.title
    }

    // Server-side ticket URL + QR generation. Single source of truth =
    // admin_settings.site_url, so the link in the email always reflects
    // whatever the admin has set as the canonical domain.
    if (type === 'ticket_issued' && data.ticket_token) {
      const siteUrl = await getSiteUrl()
      const token = data.ticket_token as string
      data.ticket_url = `${siteUrl}/ticket/${token}`
      const qrImageUrl = await generateAndUploadQr(token, data.ticket_url)
      if (qrImageUrl) data.qr_image_url = qrImageUrl
    }

    const template = messageTemplates[type]
    if (!template) {
      return new Response(JSON.stringify({ success: false, error: 'Unknown notification type' }), {
        status: 400,
        headers: jsonHeaders,
      })
    }

    const { subject, body, html } = template(data)
    const preference = guest.notification_preference || 'email'
    let success = false
    let channel: 'sms' | 'email' = 'email'

    if (preference === 'sms' && guest.phone) {
      channel = 'sms'
      success = await sendSMS(guest.phone, body)
    } else if (preference === 'email' && guest.email) {
      channel = 'email'
      success = await sendEmail(guest.email, subject, body, html)
    } else if (preference === 'none') {
      // Guest opted out
      return new Response(JSON.stringify({ success: true, channel: 'none', skipped: true }), {
        headers: jsonHeaders,
      })
    } else {
      // Fallback: try email first, then SMS
      if (guest.email) {
        channel = 'email'
        success = await sendEmail(guest.email, subject, body, html)
      } else if (guest.phone) {
        channel = 'sms'
        success = await sendSMS(guest.phone, body)
      }
    }

    // Log notification
    await supabase.from('notifications_log').insert({
      guest_id: guestId,
      event_id: eventId,
      channel,
      type,
      status: success ? 'sent' : 'failed',
      sent_at: success ? new Date().toISOString() : null,
      error: success ? null : 'Send failed',
    })

    return new Response(JSON.stringify({ success, channel }), {
      headers: jsonHeaders,
    })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
})
