import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

const messageTemplates: Record<string, (data: Record<string, string>) => { subject: string; body: string }> = {
  rsvp_confirmation: (data) => ({
    subject: `RSVP Confirmed - ${data.event_title || 'Cafe Kadhem'}`,
    body: `Thanks for your RSVP! You're ${data.status === 'yes' ? 'going' : 'on the maybe list'} for ${data.event_title || 'our event'}. We look forward to seeing you!`,
  }),
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

async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured')
    return false
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      text: body,
    }),
  })

  return response.ok
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Rate limit by IP
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!checkRateLimit(`notif:${ip}`, 10)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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

    const template = messageTemplates[type]
    if (!template) {
      return new Response(JSON.stringify({ success: false, error: 'Unknown notification type' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { subject, body } = template(data)
    const preference = guest.notification_preference || 'email'
    let success = false
    let channel: 'sms' | 'email' = 'email'

    if (preference === 'sms' && guest.phone) {
      channel = 'sms'
      success = await sendSMS(guest.phone, body)
    } else if (preference === 'email' && guest.email) {
      channel = 'email'
      success = await sendEmail(guest.email, subject, body)
    } else if (preference === 'none') {
      // Guest opted out
      return new Response(JSON.stringify({ success: true, channel: 'none', skipped: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    } else {
      // Fallback: try email first, then SMS
      if (guest.email) {
        channel = 'email'
        success = await sendEmail(guest.email, subject, body)
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
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
