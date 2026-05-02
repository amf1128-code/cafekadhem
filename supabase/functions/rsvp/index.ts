import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  if (!checkRateLimit(`rsvp:${ip}`, 10)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429,
      headers: jsonHeaders,
    })
  }

  try {
    const { eventId, guestId, status } = await req.json()

    if (!eventId || !guestId || !['yes', 'maybe', 'no'].includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid parameters' }), {
        status: 400,
        headers: jsonHeaders,
      })
    }

    // Use the database function for atomic capacity check + insert
    const { data: rsvp, error } = await supabase.rpc('safe_create_rsvp', {
      p_event_id: eventId,
      p_guest_id: guestId,
      p_status: status,
    })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: jsonHeaders,
      })
    }

    const response: Record<string, unknown> = { success: true, rsvp }
    if (rsvp?.status === 'waitlisted' && rsvp?.waitlist_position) {
      response.waitlist_position = rsvp.waitlist_position
    }

    return new Response(JSON.stringify(response), {
      headers: jsonHeaders,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
})
