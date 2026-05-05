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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Converts plain newlines in the admin-entered body to <br> tags so the
// HTML email respects paragraph breaks without requiring the admin to write HTML.
function bodyToHtmlLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => escapeHtml(line) || '&nbsp;')
    .join('<br>\n')
}

async function getSiteUrl(): Promise<string> {
  const { data } = await supabase
    .from('admin_settings')
    .select('site_url')
    .limit(1)
    .single()
  return (data?.site_url || 'https://cafekadhem.com').replace(/\/$/, '')
}

function buildBlastEmailHtml(opts: {
  eventTitle: string
  eventType: string | null
  emailSubject: string
  emailBody: string
  eventUrl: string
}): string {
  const bodyHtml = bodyToHtmlLines(opts.emailBody)
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#fdfaf3;font-family:Georgia,'Times New Roman',serif;color:#1a2e1f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf3;padding:32px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e0cf;padding:32px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <p style="margin:0;letter-spacing:0.25em;text-transform:uppercase;font-size:11px;color:#6b6452;">Cafe Kadhem</p>
        </td></tr>
        <tr><td align="center" style="padding-bottom:16px;">
          <h1 style="margin:8px 0 0;font-style:italic;font-weight:400;font-size:24px;color:#1a2e1f;">${escapeHtml(opts.eventTitle)}</h1>
          ${opts.eventType ? `<p style="margin:6px 0 0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#6b6452;">${escapeHtml(opts.eventType)}</p>` : ''}
        </td></tr>
        <tr><td style="padding:16px 0;border-top:1px solid #e7e0cf;border-bottom:1px solid #e7e0cf;">
          <p style="margin:0;font-size:15px;line-height:1.7;color:#3a3a3a;">${bodyHtml}</p>
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

async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<boolean> {
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
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, text, html }),
  })
  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    console.error('Resend send failed:', response.status, errText)
  }
  return response.ok
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  // Require authenticated admin session
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: jsonHeaders,
    })
  }
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const userClient = createClient(Deno.env.get('SUPABASE_URL') || '', anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: jsonHeaders,
    })
  }

  try {
    const { blast_id: blastId } = await req.json()
    if (!blastId) {
      return new Response(JSON.stringify({ error: 'blast_id is required' }), {
        status: 400,
        headers: jsonHeaders,
      })
    }

    // Fetch the blast record (with event data)
    const { data: blast, error: blastErr } = await supabase
      .from('notification_blasts')
      .select('*, event:events(title, event_type)')
      .eq('id', blastId)
      .single()

    if (blastErr || !blast) {
      return new Response(JSON.stringify({ error: 'Blast not found' }), {
        status: 404,
        headers: jsonHeaders,
      })
    }

    if (blast.status === 'sending' || blast.status === 'sent') {
      return new Response(JSON.stringify({ error: 'Blast already sent or in progress' }), {
        status: 409,
        headers: jsonHeaders,
      })
    }

    // Mark as sending
    await supabase
      .from('notification_blasts')
      .update({ status: 'sending' })
      .eq('id', blastId)

    const siteUrl = await getSiteUrl()
    const eventUrl = `${siteUrl}/events/${blast.event_id}`

    // Fetch admin settings (sms master switch)
    const { data: settings } = await supabase
      .from('admin_settings')
      .select('sms_enabled')
      .limit(1)
      .single()
    const smsEnabled = !!settings?.sms_enabled

    // Determine RSVP statuses to include based on audience
    let statusFilter: string[]
    if (blast.audience === 'yes_only') {
      statusFilter = ['yes']
    } else if (blast.audience === 'yes_and_maybe') {
      statusFilter = ['yes', 'maybe']
    } else {
      // all_invited: every RSVP regardless of status
      statusFilter = ['yes', 'maybe', 'no', 'waitlisted']
    }

    // Fetch RSVPs + guest details. Exclude plus-ones (plus_one_of is not null)
    // since they have no independent contact info.
    const { data: rsvps } = await supabase
      .from('rsvps')
      .select('guest_id, guest:guests(id, first_name, email, phone, notification_preference)')
      .eq('event_id', blast.event_id)
      .in('status', statusFilter)
      .is('plus_one_of', null)

    const targets = (rsvps || []) as Array<{
      guest_id: string
      guest: {
        id: string
        first_name: string
        email: string | null
        phone: string | null
        notification_preference: 'email' | 'sms' | 'none'
      }
    }>

    const eventTitle: string = (blast.event as { title: string; event_type: string | null })?.title || 'Cafe Kadhem'
    const eventType: string | null = (blast.event as { title: string; event_type: string | null })?.event_type ?? null

    const emailHtml = buildBlastEmailHtml({
      eventTitle,
      eventType,
      emailSubject: blast.email_subject,
      emailBody: blast.email_body,
      eventUrl,
    })
    const emailText = `${blast.email_body}\n\nDetails: ${eventUrl}`
    const smsText = `${blast.sms_body}\n\n${eventUrl}`

    let sentCount = 0
    let failedCount = 0
    const logs: Array<{
      guest_id: string
      event_id: string
      channel: 'email' | 'sms'
      type: string
      status: 'sent' | 'failed'
      sent_at: string | null
      error: string | null
    }> = []

    // Deduplicate by guest_id in case a guest RSVPd multiple times (shouldn't
    // happen but safe guard).
    const seen = new Set<string>()

    for (const row of targets) {
      const g = row.guest
      if (!g || seen.has(g.id)) continue
      seen.add(g.id)

      if (g.notification_preference === 'none') continue

      let success = false
      let channel: 'email' | 'sms' = 'email'

      if (g.notification_preference === 'sms' && smsEnabled && g.phone) {
        channel = 'sms'
        success = await sendSMS(g.phone, smsText)
      } else if (g.email) {
        channel = 'email'
        success = await sendEmail(g.email, blast.email_subject, emailText, emailHtml)
      } else if (smsEnabled && g.phone) {
        channel = 'sms'
        success = await sendSMS(g.phone, smsText)
      } else {
        // No reachable channel
        continue
      }

      if (success) sentCount++
      else failedCount++

      logs.push({
        guest_id: g.id,
        event_id: blast.event_id,
        channel,
        type: 'notification_blast',
        status: success ? 'sent' : 'failed',
        sent_at: success ? new Date().toISOString() : null,
        error: success ? null : 'Send failed',
      })
    }

    // Batch-insert notification logs
    if (logs.length > 0) {
      await supabase.from('notifications_log').insert(logs)
    }

    // Update blast record with final counts
    const finalStatus = failedCount > 0 && sentCount === 0 ? 'failed' : 'sent'
    await supabase
      .from('notification_blasts')
      .update({
        status: finalStatus,
        sent_count: sentCount,
        failed_count: failedCount,
        sent_at: new Date().toISOString(),
      })
      .eq('id', blastId)

    return new Response(
      JSON.stringify({ success: true, sent: sentCount, failed: failedCount }),
      { headers: jsonHeaders }
    )
  } catch (err) {
    console.error('send-blast error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
})
