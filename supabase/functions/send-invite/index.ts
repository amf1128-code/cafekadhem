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

// Rate limiting
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!checkRateLimit(`invite:${ip}`, 5)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429,
      headers: jsonHeaders,
    })
  }

  try {
    const { eventId, contactInfo, inviteToken, invitedByName } = await req.json()

    // Get event info
    const { data: event } = await supabase
      .from('events')
      .select('title')
      .eq('id', eventId)
      .single()

    const eventTitle = event?.title || 'an event at Cafe Kadhem'
    const inviteUrl = `${SITE_URL}/invite/${inviteToken}`

    const personalTouch = invitedByName
      ? `${invitedByName} invited you to `
      : "You're invited to "

    const message = `${personalTouch}${eventTitle}! Check it out: ${inviteUrl}`
    const subject = `You're invited to ${eventTitle}`

    let success = false
    let channel: 'sms' | 'email' = 'email'

    if (contactInfo.phone) {
      channel = 'sms'
      if (TELNYX_API_KEY) {
        const response = await fetch('https://api.telnyx.com/v2/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TELNYX_API_KEY}`,
          },
          body: JSON.stringify({
            from: TELNYX_FROM_NUMBER,
            to: contactInfo.phone,
            text: message,
            messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
          }),
        })
        success = response.ok
      }
    } else if (contactInfo.email) {
      channel = 'email'
      if (RESEND_API_KEY) {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [contactInfo.email],
            subject,
            text: message,
          }),
        })
        success = response.ok
      }
    }

    // Log
    await supabase.from('notifications_log').insert({
      event_id: eventId,
      channel,
      type: 'invite',
      status: success ? 'sent' : 'failed',
      sent_at: success ? new Date().toISOString() : null,
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
