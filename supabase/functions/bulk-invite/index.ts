// bulk-invite — preview + confirm + retry-failed for resumable
// bulk invite jobs. JWT-gated. Per-recipient state lives in
// bulk_invite_job_recipients so a job survives a tab close and
// "Retry failed" only re-targets the rows that previously failed.
//
// USER_FLOWS_SPEC.md §8.

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
  const { data } = await admin.from('admin_settings').select('site_url').limit(1).single()
  return (data?.site_url || 'https://cafekadhem.com').replace(/\/$/, '')
}

async function verifyAdminJwt(req: Request): Promise<{ ok: boolean; user_id?: string }> {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return { ok: false }
  const token = auth.slice(7)
  const verify = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await verify.auth.getUser()
  if (error || !data?.user) return { ok: false }
  return { ok: true, user_id: data.user.id }
}

async function sendInviteSMS(to: string, text: string): Promise<boolean> {
  if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) return false
  try {
    const r = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TELNYX_API_KEY}` },
      body: JSON.stringify({
        from: TELNYX_FROM_NUMBER,
        to,
        text,
        messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
      }),
    })
    return r.ok
  } catch { return false }
}

async function sendInviteEmail(to: string, subject: string, text: string, html: string): Promise<boolean> {
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

type GuestShape = {
  id: string
  first_name: string | null
  email: string | null
  phone: string | null
  notification_preference: 'sms' | 'email' | 'both' | 'none' | null
}

function resolveChannel(g: GuestShape, smsEnabled: boolean): { channel: 'sms' | 'email'; resolved_email: string | null; resolved_phone: string | null } | null {
  if (g.notification_preference === 'none') return null
  if (g.notification_preference === 'sms' && smsEnabled && g.phone) {
    return { channel: 'sms', resolved_email: null, resolved_phone: g.phone }
  }
  if (g.email) return { channel: 'email', resolved_email: g.email, resolved_phone: null }
  if (smsEnabled && g.phone) return { channel: 'sms', resolved_email: null, resolved_phone: g.phone }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: corsHeaders })

  const auth = await verifyAdminJwt(req)
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  let body: { action: string; [k: string]: unknown }
  try { body = await req.json() } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: jsonHeaders }) }

  if (body.action === 'preview') return await handlePreview(body, auth.user_id!)
  if (body.action === 'confirm') return await handleConfirm(body)
  if (body.action === 'retry_failed') return await handleRetryFailed(body, auth.user_id!)
  return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers: jsonHeaders })
})

async function handlePreview(body: Record<string, unknown>, userId: string): Promise<Response> {
  const eventId = body.event_id as string
  const guestIds = body.guest_ids as string[]
  if (!eventId || !Array.isArray(guestIds) || guestIds.length === 0) {
    return new Response(JSON.stringify({ error: 'event_id + guest_ids required' }), { status: 400, headers: jsonHeaders })
  }

  // Fetch settings + guest rows + existing invites for this event.
  const [{ data: settings }, { data: guests }, { data: existingInvites }] = await Promise.all([
    admin.from('admin_settings').select('sms_enabled').limit(1).single(),
    admin.from('guests').select('id, first_name, email, phone, notification_preference').in('id', guestIds),
    admin
      .from('invites')
      .select('invited_email, invited_phone, last_sent_at')
      .eq('event_id', eventId)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ])
  const smsEnabled = !!settings?.sms_enabled

  // Build a "recently invited" set so we can skip duplicates within 24h.
  const recentEmails = new Set<string>()
  const recentPhones = new Set<string>()
  for (const inv of existingInvites ?? []) {
    if (inv.invited_email) recentEmails.add(inv.invited_email.toLowerCase())
    if (inv.invited_phone) recentPhones.add(inv.invited_phone)
  }

  // Create the job row.
  const { data: job, error: jobErr } = await admin
    .from('bulk_invite_jobs')
    .insert({ event_id: eventId, created_by: userId, status: 'preview' })
    .select('id')
    .single()
  if (jobErr || !job) {
    return new Response(JSON.stringify({ error: jobErr?.message ?? 'job insert failed' }), { status: 500, headers: jsonHeaders })
  }

  // Categorize each guest.
  const recipientRows: Array<{
    job_id: string
    guest_id: string
    channel: string | null
    resolved_email: string | null
    resolved_phone: string | null
    status: string
    skip_reason: string | null
  }> = []
  const guestById = new Map((guests ?? []).map((g) => [g.id, g as GuestShape]))
  let willSend = 0
  for (const gid of guestIds) {
    const g = guestById.get(gid)
    if (!g) {
      recipientRows.push({
        job_id: job.id, guest_id: gid, channel: null, resolved_email: null, resolved_phone: null,
        status: 'skipped', skip_reason: 'guest_not_found',
      })
      continue
    }
    if (g.notification_preference === 'none') {
      recipientRows.push({
        job_id: job.id, guest_id: gid, channel: null, resolved_email: null, resolved_phone: null,
        status: 'skipped', skip_reason: 'opted_out',
      })
      continue
    }
    const ch = resolveChannel(g, smsEnabled)
    if (!ch) {
      recipientRows.push({
        job_id: job.id, guest_id: gid, channel: null, resolved_email: null, resolved_phone: null,
        status: 'skipped', skip_reason: 'no_reachable_channel',
      })
      continue
    }
    // Recently invited for this event?
    const alreadyEmailed = ch.resolved_email && recentEmails.has(ch.resolved_email.toLowerCase())
    const alreadyTexted = ch.resolved_phone && recentPhones.has(ch.resolved_phone)
    if (alreadyEmailed || alreadyTexted) {
      recipientRows.push({
        job_id: job.id, guest_id: gid, channel: ch.channel, resolved_email: ch.resolved_email, resolved_phone: ch.resolved_phone,
        status: 'skipped', skip_reason: 'recently_invited',
      })
      continue
    }
    recipientRows.push({
      job_id: job.id, guest_id: gid, channel: ch.channel, resolved_email: ch.resolved_email, resolved_phone: ch.resolved_phone,
      status: 'will_send', skip_reason: null,
    })
    willSend++
  }

  await admin.from('bulk_invite_job_recipients').insert(recipientRows)
  await admin.from('bulk_invite_jobs').update({ total_recipients: willSend }).eq('id', job.id)

  return new Response(
    JSON.stringify({ job_id: job.id, will_send: willSend, total: recipientRows.length }),
    { headers: jsonHeaders },
  )
}

async function handleConfirm(body: Record<string, unknown>): Promise<Response> {
  const jobId = body.job_id as string
  if (!jobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400, headers: jsonHeaders })

  // Fetch job + event.
  const { data: job } = await admin
    .from('bulk_invite_jobs').select('*').eq('id', jobId).single()
  if (!job) return new Response(JSON.stringify({ error: 'job not found' }), { status: 404, headers: jsonHeaders })

  // Idempotency: only confirm jobs in 'preview' or stuck 'sending'.
  if (job.status === 'completed') {
    return new Response(JSON.stringify({ already: true }), { headers: jsonHeaders })
  }
  if (job.status === 'sending' && job.started_at) {
    const ageMs = Date.now() - new Date(job.started_at).getTime()
    if (ageMs < 10 * 60 * 1000) {
      return new Response(JSON.stringify({ error: 'job already in flight' }), { status: 409, headers: jsonHeaders })
    }
  }
  if (job.status !== 'preview' && job.status !== 'sending') {
    return new Response(JSON.stringify({ error: `cannot confirm status=${job.status}` }), { status: 409, headers: jsonHeaders })
  }

  await admin.from('bulk_invite_jobs')
    .update({ status: 'sending', started_at: new Date().toISOString() })
    .eq('id', jobId)

  const { data: event } = await admin.from('events').select('id, title').eq('id', job.event_id).single()
  if (!event) {
    await admin.from('bulk_invite_jobs').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', jobId)
    return new Response(JSON.stringify({ error: 'event not found' }), { status: 404, headers: jsonHeaders })
  }

  // Fetch will_send recipients for this job. Skip ones already sent/failed
  // from a prior partial run (per-row dedup).
  const { data: recipients } = await admin
    .from('bulk_invite_job_recipients')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'will_send')

  const siteUrl = await getSiteUrl()

  let sentCount = 0
  let failedCount = 0

  for (const rec of recipients ?? []) {
    let invite_id: string | null = null
    let notification_id: string | null = null
    let ok = false
    let errorMsg: string | null = null

    try {
      // Insert (or reuse) invite. Partial unique index from migration 032
      // ensures (event_id, invited_by, lower(email)|phone) is unique;
      // duplicate insert returns the existing row's token via SELECT.
      const inviteFields: Record<string, unknown> = {
        event_id: job.event_id,
        invited_by: job.created_by,
        invited_email: rec.resolved_email,
        invited_phone: rec.resolved_phone,
      }
      const { data: inserted } = await admin
        .from('invites')
        .insert(inviteFields)
        .select('id, token')
        .single()
      let token: string | undefined = inserted?.token
      invite_id = inserted?.id ?? null
      if (!token) {
        // Conflict — re-fetch by target.
        const lookupQuery = admin.from('invites').select('id, token').eq('event_id', job.event_id).eq('invited_by', job.created_by)
        const { data: existing } = rec.resolved_email
          ? await lookupQuery.ilike('invited_email', rec.resolved_email).limit(1).maybeSingle()
          : await lookupQuery.eq('invited_phone', rec.resolved_phone!).limit(1).maybeSingle()
        token = existing?.token
        invite_id = existing?.id ?? null
      }
      if (!token) throw new Error('failed to resolve invite token')

      // Render + send.
      const inviteUrl = `${siteUrl}/invite/${token}`
      const text = `You're invited to ${event.title} at Cafe Kadhem. RSVP: ${inviteUrl}`
      const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#fdfaf3;font-family:Georgia,'Times New Roman',serif;color:#1a2e1f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf3;padding:32px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e0cf;padding:32px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <p style="margin:0;letter-spacing:0.25em;text-transform:uppercase;font-size:11px;color:#6b6452;">Cafe Kadhem</p>
        </td></tr>
        <tr><td align="center" style="padding-bottom:24px;">
          <h1 style="margin:8px 0 0;font-style:italic;font-weight:400;font-size:24px;color:#1a2e1f;">You're invited to ${escapeHtml(event.title)}</h1>
        </td></tr>
        <tr><td align="center" style="padding:16px 0 8px;">
          <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#1a2e1f;color:#fdfaf3;text-decoration:none;padding:14px 28px;letter-spacing:0.2em;text-transform:uppercase;font-size:12px;">RSVP</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

      if (rec.channel === 'sms' && rec.resolved_phone) {
        ok = await sendInviteSMS(rec.resolved_phone, text)
      } else if (rec.channel === 'email' && rec.resolved_email) {
        ok = await sendInviteEmail(rec.resolved_email, `You're invited — ${event.title}`, text, html)
      }

      // Log to notifications_log (if guest_id is set).
      if (rec.guest_id) {
        const { data: logged } = await admin.from('notifications_log').insert({
          guest_id: rec.guest_id,
          event_id: job.event_id,
          channel: rec.channel,
          type: 'invite',
          status: ok ? 'sent' : 'failed',
          dedup_key: `bulk_invite:${jobId}:${rec.guest_id}`,
          sent_at: ok ? new Date().toISOString() : null,
          error: ok ? null : 'send failed',
        }).select('id').single()
        notification_id = logged?.id ?? null
      }

      // Update invites.last_sent_at
      if (invite_id) {
        await admin.from('invites').update({ last_sent_at: new Date().toISOString() }).eq('id', invite_id)
      }
    } catch (err) {
      ok = false
      errorMsg = err instanceof Error ? err.message : String(err)
    }

    await admin.from('bulk_invite_job_recipients').update({
      invite_id,
      notification_id,
      status: ok ? 'sent' : 'failed',
      error: errorMsg,
      sent_at: ok ? new Date().toISOString() : null,
    }).eq('id', rec.id)

    if (ok) sentCount++
    else failedCount++
  }

  const finalStatus = sentCount === 0 && failedCount > 0 ? 'failed' : 'completed'
  await admin.from('bulk_invite_jobs').update({
    status: finalStatus,
    completed_at: new Date().toISOString(),
  }).eq('id', jobId)

  return new Response(JSON.stringify({ success: true, sent: sentCount, failed: failedCount }), { headers: jsonHeaders })
}

async function handleRetryFailed(body: Record<string, unknown>, userId: string): Promise<Response> {
  const sourceJobId = body.job_id as string
  if (!sourceJobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400, headers: jsonHeaders })

  const { data: src } = await admin.from('bulk_invite_jobs').select('*').eq('id', sourceJobId).single()
  if (!src) return new Response(JSON.stringify({ error: 'source job not found' }), { status: 404, headers: jsonHeaders })

  const { data: failedRows } = await admin
    .from('bulk_invite_job_recipients')
    .select('*')
    .eq('job_id', sourceJobId)
    .eq('status', 'failed')

  if (!failedRows || failedRows.length === 0) {
    return new Response(JSON.stringify({ error: 'no failed rows to retry' }), { status: 400, headers: jsonHeaders })
  }

  const { data: newJob } = await admin
    .from('bulk_invite_jobs')
    .insert({
      event_id: src.event_id,
      created_by: userId,
      status: 'preview',
      retry_of_job_id: sourceJobId,
      total_recipients: failedRows.length,
    })
    .select('id')
    .single()
  if (!newJob) return new Response(JSON.stringify({ error: 'new job insert failed' }), { status: 500, headers: jsonHeaders })

  const recipientCopies = failedRows.map((r) => ({
    job_id: newJob.id,
    guest_id: r.guest_id,
    channel: r.channel,
    resolved_email: r.resolved_email,
    resolved_phone: r.resolved_phone,
    status: 'will_send',
    skip_reason: null,
  }))
  await admin.from('bulk_invite_job_recipients').insert(recipientCopies)

  return new Response(JSON.stringify({ job_id: newJob.id, will_send: failedRows.length }), { headers: jsonHeaders })
}
