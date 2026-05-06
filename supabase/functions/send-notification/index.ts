import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// qrcode-generator is pure JS with no Node-specific deps, so it loads cleanly
// under Deno via esm.sh (unlike the npm 'qrcode' package which depends on
// pngjs / Buffer and fails silently here).
import qrcodeGenerator from 'https://esm.sh/qrcode-generator@1.4.4'

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

function randomTokenHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function getSiteUrl(): Promise<string> {
  const { data } = await supabase
    .from('admin_settings')
    .select('site_url')
    .limit(1)
    .single()
  return (data?.site_url || 'https://cafekadhem.com').replace(/\/$/, '')
}

// Append ?as=<ambient_token> to URLs on our own domain so a recipient
// who taps the link is recognized server-side and silently identified
// in localStorage. Skips:
//   - off-domain URLs (never leak our token to third parties)
//   - URLs that already carry an ?as= (idempotent on retry)
//   - the /verify-merge URL (single-use credential; recognition is
//     handled by the verify flow itself)
// USER_FLOWS_SPEC.md §3a.2.
function injectAmbientToken(rawUrl: string, ambientToken: string, siteHost: string): string {
  if (!rawUrl) return rawUrl
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return rawUrl
  }
  if (parsed.host !== siteHost) return rawUrl
  if (parsed.searchParams.has('as')) return rawUrl
  if (parsed.pathname.startsWith('/verify-merge')) return rawUrl
  parsed.searchParams.set('as', ambientToken)
  return parsed.toString()
}

// The DB stores events as DATE + TIME without a timezone. The cafe is in
// NYC, so we render every guest-facing date string in America/New_York.
// We avoid `new Date(\`${date}T${time}\`)` (which interprets in the runtime
// TZ — typically UTC on Deno Edge — and would shift the displayed hour)
// by formatting the time parts directly.
function formatEventTime(t: string): string {
  const [hRaw, mRaw] = t.split(':')
  const h = Number(hRaw)
  const m = Number(mRaw)
  const hour12 = h % 12 === 0 ? 12 : h % 12
  const meridiem = h < 12 ? 'AM' : 'PM'
  return m === 0
    ? `${hour12} ${meridiem}`
    : `${hour12}:${String(m).padStart(2, '0')} ${meridiem}`
}

function formatEventWhen(date: string, startTime: string, endTime: string | null): string {
  // Anchor the day in ET noon so DST rollovers can never flip the
  // weekday. Only the date components are read out; time comes from
  // formatEventTime above, which never goes through Date math.
  const dayDate = new Date(`${date}T12:00:00-05:00`)
  const dateStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  }).format(dayDate)
  const start = formatEventTime(startTime)
  if (endTime) {
    return `${dateStr} from ${start} to ${formatEventTime(endTime)}`
  }
  return `${dateStr} at ${start}`
}

// ICS calendar-attachment helpers. Mail clients (Gmail, Apple Mail,
// Outlook) detect text/calendar attachments and surface a one-click
// "Add to Calendar" button.

// Convert an ET wall-clock datetime (the format the events table stores)
// into a UTC Date instant. Handles EST/EDT correctly: we sample noon UTC
// on the target date and read back the ET hour to recover the offset
// for that day.
function etDateTimeToUtc(date: string, time: string): Date {
  const sample = new Date(`${date}T12:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
  }).formatToParts(sample)
  const etHour = Number(parts.find((p) => p.type === 'hour')!.value)
  // 12 UTC -> 7 ET means EST (UTC-5); 8 ET means EDT (UTC-4).
  const offsetHours = etHour === 7 ? -5 : -4
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h - offsetHours, mi))
}

function toIcsUtc(d: Date): string {
  // ICS UTC format: YYYYMMDDTHHMMSSZ (no dashes, no colons, no millis).
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escapeIcs(s: string): string {
  // RFC 5545 §3.3.11: escape backslash, semicolon, comma, newline.
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// Base64-encode a UTF-8 string. Plain btoa() only accepts Latin-1, so
// any Arabic / accented / emoji content in an event title or location
// would throw InvalidCharacterError. We round-trip through TextEncoder
// to keep multi-byte chars intact.
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

interface IcsOpts {
  uid: string
  summary: string
  description: string
  location: string
  date: string
  startTime: string
  endTime: string | null
  url: string
  status: 'CONFIRMED' | 'TENTATIVE'
}

function buildIcs(opts: IcsOpts): string {
  const start = etDateTimeToUtc(opts.date, opts.startTime)
  // Default to a 2-hour event when no end_time is set; matches what most
  // calendar clients show by default for a missing DTEND.
  const end = opts.endTime
    ? etDateTimeToUtc(opts.date, opts.endTime)
    : new Date(start.getTime() + 2 * 60 * 60 * 1000)

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cafe Kadhem//RSVP//EN',
    'CALSCALE:GREGORIAN',
    // PUBLISH (vs REQUEST) tells the client this is an event the user
    // is being told about, not a meeting invitation expecting a response.
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${opts.uid}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcs(opts.summary)}`,
    `DESCRIPTION:${escapeIcs(opts.description)}`,
    `LOCATION:${escapeIcs(opts.location)}`,
    `URL:${opts.url}`,
    `STATUS:${opts.status}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  // CRLF line endings are required by RFC 5545.
  return lines.join('\r\n')
}

// Generate a QR PNG-equivalent (GIF) for the ticket URL and upload it to
// the public 'tickets' Supabase Storage bucket. The email <img> points at
// the storage public URL; the image is served from our own infra. Returns
// the public URL on success, or null on failure (caller falls back to the
// plain ticket-page link in the email).
async function generateAndUploadQr(token: string, encodedUrl: string): Promise<string | null> {
  try {
    const qr = qrcodeGenerator(0, 'M')
    qr.addData(encodedUrl)
    qr.make()
    // createDataURL returns "data:image/gif;base64,...". GIF is universally
    // rendered by email clients in <img> tags — no advantage to PNG here.
    const dataUrl: string = qr.createDataURL(8, 4)
    const base64 = dataUrl.split(',')[1]
    if (!base64) {
      console.error('QR generation: empty data URL')
      return null
    }
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

    const { error: uploadError } = await supabase.storage
      .from('tickets')
      .upload(`${token}.gif`, bytes, {
        contentType: 'image/gif',
        upsert: true,
      })
    if (uploadError) {
      console.error('QR upload failed:', uploadError.message)
      return null
    }

    const { data } = supabase.storage.from('tickets').getPublicUrl(`${token}.gif`)
    return data.publicUrl
  } catch (err) {
    console.error('QR generation failed:', err)
    return null
  }
}

const messageTemplates: Record<string, (data: Record<string, string>) => { subject: string; body: string; html?: string }> = {
  rsvp_confirmation: (data) => {
    const title = data.event_title || 'Cafe Kadhem'
    const greeting = data.first_name ? `Hey ${data.first_name},` : 'Hey,'
    const ticketed = data.is_ticketed === 'true'

    // Possessive form for the lead sentence. When event_title is missing
    // (the fallback "Cafe Kadhem"), drop the possessive to avoid
    // "Cafe Kadhem's Cafe Kadhem".
    const eventLabel = data.event_title ? `Cafe Kadhem's ${data.event_title}` : 'Cafe Kadhem'

    // Per-status copy. `lead` continues the greeting sentence
    // ("Hey Alice, you're going to ..."), so it starts lowercase.
    // `tail` is the outro that follows the event details block. Both
    // are reused in the plain-text body and the HTML body so the two
    // stay in sync.
    let subject: string
    let lead: string
    let tail: string
    if (data.status === 'waitlisted') {
      subject = `You're on the waitlist - ${title}`
      lead = `you're on the waitlist for ${eventLabel}.`
      tail = `We'll follow up if a spot opens up.`
    } else if (ticketed && data.status === 'yes') {
      subject = `We got your RSVP - ${title}`
      lead = `we got your RSVP for ${eventLabel}.`
      tail = `Make sure your Venmo went through — we'll send your ticket within 48 hours once payment is confirmed.`
    } else if (data.status === 'yes') {
      subject = `RSVP Confirmed - ${title}`
      lead = `you're going to ${eventLabel}.`
      tail = `Looking forward to seeing you!`
    } else {
      // status === 'maybe'
      subject = `RSVP Received - ${title}`
      lead = `you're on the maybe list for ${eventLabel}.`
      tail = `Hope you can make it.`
    }

    // Plain-text body: greeting + lead inline (one sentence), then
    // tail, details, and link separated by blank lines. SMS recipients
    // see this verbatim, so it has to read well as one continuous
    // message. Email clients fall back to it when HTML is disabled.
    const detailLines: string[] = []
    if (data.event_when) detailLines.push(`When: ${data.event_when}`)
    if (data.event_where) detailLines.push(`Where: ${data.event_where}`)
    const details = detailLines.length ? `\n\n${detailLines.join('\n')}` : ''
    const link = data.event_url ? `\n\nDetails: ${data.event_url}` : ''
    const body = `${greeting} ${lead} ${tail}${details}${link}`

    // HTML body: same content, styled to match the existing
    // ticket_issued / pickup_order_confirmation emails.
    const detailRow = (label: string, value: string) => `
        <tr><td align="center" style="padding:6px 0;">
          <p style="margin:0;letter-spacing:0.18em;text-transform:uppercase;font-size:10px;color:#6b6452;">${label}</p>
          <p style="margin:4px 0 0;font-size:14px;color:#1a2e1f;">${escapeHtml(value)}</p>
        </td></tr>`
    const detailsBlock = (data.event_when || data.event_where)
      ? `<tr><td align="center" style="padding:16px 0 8px;border-top:1px solid #e7e0cf;border-bottom:1px solid #e7e0cf;">
          <table cellpadding="0" cellspacing="0" width="100%">
            ${data.event_when ? detailRow('Date', data.event_when) : ''}
            ${data.event_where ? detailRow('Location', data.event_where) : ''}
          </table>
        </td></tr>`
      : ''
    const button = data.event_url
      ? `<tr><td align="center" style="padding:24px 0 8px;">
          <a href="${escapeHtml(data.event_url)}" style="display:inline-block;background:#1a2e1f;color:#fdfaf3;text-decoration:none;padding:14px 28px;letter-spacing:0.2em;text-transform:uppercase;font-size:12px;">View Event</a>
        </td></tr>`
      : ''
    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#fdfaf3;font-family:Georgia,'Times New Roman',serif;color:#1a2e1f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf3;padding:32px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e0cf;padding:32px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <p style="margin:0;letter-spacing:0.25em;text-transform:uppercase;font-size:11px;color:#6b6452;">Cafe Kadhem</p>
        </td></tr>
        <tr><td align="center" style="padding-bottom:8px;">
          <h1 style="margin:8px 0 0;font-style:italic;font-weight:400;font-size:24px;color:#1a2e1f;">${escapeHtml(title)}</h1>
          ${data.event_type ? `<p style="margin:6px 0 0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#6b6452;">${escapeHtml(data.event_type)}</p>` : ''}
        </td></tr>
        <tr><td align="center" style="padding:16px 0 8px;">
          <p style="margin:0;font-size:15px;line-height:1.5;color:#3a3a3a;">${escapeHtml(`${greeting} ${lead}`)}</p>
        </td></tr>
        ${detailsBlock}
        <tr><td align="center" style="padding:16px 0 0;">
          <p style="margin:0;font-size:14px;line-height:1.5;color:#3a3a3a;font-style:italic;">${escapeHtml(tail)}</p>
        </td></tr>
        ${button}
      </table>
    </td></tr>
  </table>
</body></html>`

    return { subject, body, html }
  },
  order_confirmation: (data) => {
    const link = data.history_url ? `\n\nView your order: ${data.history_url}` : ''
    return {
      subject: `Order Confirmed - ${data.event_title || 'Cafe Kadhem'}`,
      body: `Your pre-order for ${data.event_title || 'our event'} has been submitted. Your host will confirm payment once received via Venmo.${link}`,
    }
  },
  pickup_order_confirmation: (data) => {
    const when = data.pickup_when ? ` for ${data.pickup_when}` : ''
    const ticketLink = data.pickup_url ? `\n\nShow this at pickup: ${data.pickup_url}` : ''
    const historyLink = data.history_url ? `\n\nAll your orders: ${data.history_url}` : ''
    const text = `Your pick-up order${when} has been submitted. Your host will confirm payment once received via Venmo.${ticketLink}${historyLink}`
    if (!data.pickup_url) {
      return { subject: 'Pick-Up Order Confirmed - Cafe Kadhem', body: text }
    }
    const qrImg = data.qr_image_url
      ? `<tr><td align="center" style="padding:16px 0;">
           <img src="${escapeHtml(data.qr_image_url)}" alt="Pickup QR code" width="240" height="240" style="display:block;border:1px solid #e7e0cf;background:#fdfaf3;" />
         </td></tr>`
      : ''
    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#fdfaf3;font-family:Georgia,'Times New Roman',serif;color:#1a2e1f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf3;padding:32px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e0cf;padding:32px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <p style="margin:0;letter-spacing:0.25em;text-transform:uppercase;font-size:11px;color:#6b6452;">Cafe Kadhem</p>
        </td></tr>
        <tr><td align="center" style="padding-bottom:24px;">
          <h1 style="margin:8px 0 0;font-style:italic;font-weight:400;font-size:24px;color:#1a2e1f;">Pick-Up Order</h1>
          ${data.pickup_when ? `<p style="margin:8px 0 0;font-size:14px;color:#3a3a3a;">${escapeHtml(data.pickup_when)}</p>` : ''}
        </td></tr>
        <tr><td align="center" style="padding:16px 0 8px;border-top:1px solid #e7e0cf;">
          <p style="margin:0;font-size:14px;color:#3a3a3a;">Show this QR at pickup:</p>
        </td></tr>
        ${qrImg}
        <tr><td align="center" style="padding:16px 0 8px;">
          <a href="${escapeHtml(data.pickup_url)}" style="display:inline-block;background:#1a2e1f;color:#fdfaf3;text-decoration:none;padding:14px 28px;letter-spacing:0.2em;text-transform:uppercase;font-size:12px;">View Your Order</a>
        </td></tr>
        ${data.history_url ? `<tr><td align="center" style="padding:8px 0;">
          <a href="${escapeHtml(data.history_url)}" style="font-size:12px;color:#6b6452;">All your orders</a>
        </td></tr>` : ''}
      </table>
    </td></tr>
  </table>
</body></html>`
    return { subject: 'Pick-Up Order Confirmed - Cafe Kadhem', body: text, html }
  },
  event_update: (data) => ({
    subject: `Event Update - ${data.event_title || 'Cafe Kadhem'}`,
    body: `There's been an update to ${data.event_title || 'an event'} you RSVP'd to. Check the event page for the latest details.`,
  }),
  event_reminder: (data) => ({
    subject: `Reminder - ${data.event_title || 'Cafe Kadhem'} Tomorrow!`,
    body: `Reminder: ${data.event_title || 'Your event'} is tomorrow! See you there.`,
  }),
  waitlist_promoted: (data) => {
    if (data.is_ticketed === 'true') {
      const eventLink = data.event_url ? `\n\n${data.event_url}` : ''
      return {
        subject: `A spot opened up - ${data.event_title || 'Cafe Kadhem'}`,
        body: `Good news — a spot opened up at ${data.event_title || 'our event'} and you're off the waitlist! To confirm your seat, please buy your ticket ASAP. We'll follow up with your ticket once payment is received.${eventLink}`,
      }
    }
    return {
      subject: `You're In! - ${data.event_title || 'Cafe Kadhem'}`,
      body: `Great news! A spot opened up at ${data.event_title || 'our event'} and you've been promoted from the waitlist. You're confirmed! See you there.`,
    }
  },
  merge_verification: (data) => {
    // verification_token is minted server-side by upsert_guest (Case B).
    // The frontend passes it through; we render the link.
    // verify_url is built in the request handler block above.
    const url = data.verify_url || ''
    const greeting = data.first_name ? `Hi ${data.first_name},` : 'Hi,'
    const text = `${greeting}\n\nIt looks like you may already have an account with us under a different contact. Tap the link below to confirm and we'll combine them so your RSVPs and tickets all live in one place.\n\n${url}\n\nThis link expires in 30 minutes. If you didn't try to RSVP just now, ignore this message.`
    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#fdfaf3;font-family:Georgia,'Times New Roman',serif;color:#1a2e1f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf3;padding:32px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e0cf;padding:32px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <p style="margin:0;letter-spacing:0.25em;text-transform:uppercase;font-size:11px;color:#6b6452;">Cafe Kadhem</p>
        </td></tr>
        <tr><td align="center" style="padding-bottom:24px;">
          <h1 style="margin:8px 0 0;font-style:italic;font-weight:400;font-size:22px;color:#1a2e1f;">Confirm it's you</h1>
        </td></tr>
        <tr><td align="center" style="padding:16px 0 8px;">
          <p style="margin:0;font-size:15px;line-height:1.5;color:#3a3a3a;">${escapeHtml(greeting)}</p>
          <p style="margin:8px 0 0;font-size:15px;line-height:1.5;color:#3a3a3a;">It looks like you may already have an account with us under a different contact. Tap below to confirm and we'll combine them so your RSVPs and tickets all live in one place.</p>
        </td></tr>
        <tr><td align="center" style="padding:24px 0 8px;">
          <a href="${escapeHtml(url)}" style="display:inline-block;background:#1a2e1f;color:#fdfaf3;text-decoration:none;padding:14px 28px;letter-spacing:0.2em;text-transform:uppercase;font-size:12px;">Confirm</a>
        </td></tr>
        <tr><td align="center" style="padding:8px 0;">
          <p style="margin:0;font-size:12px;color:#6b6452;">This link expires in 30 minutes. If you didn't try to RSVP just now, ignore this message.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
    return {
      subject: `Confirm it's you — Cafe Kadhem`,
      body: text,
      html,
    }
  },
  ticket_issued: (data) => {
    const eventTitle = data.event_title || 'Cafe Kadhem'
    const ticketUrl = data.ticket_url || ''
    const qrImageUrl = data.qr_image_url || ''
    const text = `You're confirmed for ${eventTitle}.\n\nView your ticket and QR code here:\n${ticketUrl}\n\nShow the QR (in this email or on the page above) at the door for entry.`
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
        ${qrImageUrl ? `<tr><td align="center" style="padding:16px 0;">
          <img src="${escapeHtml(qrImageUrl)}" alt="Ticket QR code" width="280" height="280" style="display:block;border:1px solid #e7e0cf;background:#fdfaf3;" />
        </td></tr>` : ''}
        <tr><td align="center" style="padding:16px 0 8px;">
          <a href="${escapeHtml(ticketUrl)}" style="display:inline-block;background:#1a2e1f;color:#fdfaf3;text-decoration:none;padding:14px 28px;letter-spacing:0.2em;text-transform:uppercase;font-size:12px;">View Your Ticket</a>
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

interface EmailAttachment {
  filename: string
  content: string // base64
  contentType: string
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  html?: string,
  attachments?: EmailAttachment[],
): Promise<boolean> {
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
  if (attachments && attachments.length > 0) payload.attachments = attachments

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

    // Make the recipient's first name available to every template.
    if (guest.first_name) data.first_name = guest.first_name

    // Get event info for message templates. Pulled in one shot so any
    // template can render title / when / where / link without each one
    // having to query the events row again. Hoisted to the outer scope
    // so the calendar-attachment block below can also reach the raw
    // date/time fields.
    let eventRow: {
      title: string
      date: string
      start_time: string
      end_time: string | null
      location: string
      location_name: string | null
      event_type: string | null
    } | null = null
    if (eventId) {
      const { data: e } = await supabase
        .from('events')
        .select('title, date, start_time, end_time, location, location_name, event_type')
        .eq('id', eventId)
        .single()
      eventRow = e
      if (eventRow) {
        data.event_title = eventRow.title
        if (eventRow.event_type) data.event_type = eventRow.event_type
        data.event_when = formatEventWhen(eventRow.date, eventRow.start_time, eventRow.end_time)
        data.event_where = eventRow.location_name
          ? `${eventRow.location_name} (${eventRow.location})`
          : eventRow.location
        const siteUrl = await getSiteUrl()
        data.event_url = `${siteUrl}/events/${eventId}`
      }
    }

    // Server-side URL building. Single source of truth = admin_settings.site_url,
    // so links in emails always reflect whatever the admin has set as the
    // canonical domain. Callers MUST pass ticket_token for ticket_issued and
    // we reject the request otherwise — silent fallbacks would let a
    // misbehaving caller send a broken email without anyone noticing.
    if (type === 'ticket_issued') {
      const token = data.ticket_token as string | undefined
      if (!token) {
        return new Response(
          JSON.stringify({ success: false, error: 'ticket_token is required for ticket_issued' }),
          { status: 400, headers: jsonHeaders }
        )
      }
      const siteUrl = await getSiteUrl()
      data.ticket_url = `${siteUrl}/ticket/${token}`
      const qrImageUrl = await generateAndUploadQr(token, data.ticket_url)
      if (qrImageUrl) data.qr_image_url = qrImageUrl
    }
    if (type === 'merge_verification') {
      const token = data.verification_token as string | undefined
      if (!token) {
        return new Response(
          JSON.stringify({ success: false, error: 'verification_token is required for merge_verification' }),
          { status: 400, headers: jsonHeaders }
        )
      }
      const siteUrl = await getSiteUrl()
      data.verify_url = `${siteUrl}/verify-merge?token=${token}`
    }
    if (type === 'order_confirmation' || type === 'pickup_order_confirmation') {
      // Mint a one-time magic link to /my-tickets so the guest lands on a
      // page showing this order alongside any other history they have.
      const token = randomTokenHex(24)
      const tokenHash = await sha256Hex(token)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const channel: 'sms' | 'email' = (guest.notification_preference === 'sms' && guest.phone) ? 'sms' : 'email'
      const { error: linkErr } = await supabase.from('magic_links').insert({
        guest_id: guestId,
        token_hash: tokenHash,
        channel,
        expires_at: expiresAt,
      })
      const siteUrl = await getSiteUrl()
      if (!linkErr) {
        data.history_url = `${siteUrl}/my-tickets?t=${token}`
      } else {
        console.error('order_confirmation magic link insert failed:', linkErr.message)
      }
      // Pickup orders also get a per-order page with a scannable QR so the
      // host can verify the order on the spot. The token comes from the
      // caller — pickup_orders.pickup_token, returned by safe_create_pickup_order.
      if (type === 'pickup_order_confirmation' && data.pickup_token) {
        data.pickup_url = `${siteUrl}/pickup/${data.pickup_token}`
        const qrImageUrl = await generateAndUploadQr(data.pickup_token, data.pickup_url)
        if (qrImageUrl) data.qr_image_url = qrImageUrl
      }
    }

    // Mint an ambient token for this guest and append ?as=<token> to
    // every same-domain URL we built above. Recipients who tap any link
    // in the body are recognized silently — no form, no friction.
    // USER_FLOWS_SPEC.md §3a.2.
    try {
      const { data: tokenRow } = await supabase.rpc('mint_ambient_token', {
        p_guest_id: guestId,
      })
      const ambientToken: string | null = typeof tokenRow === 'string' ? tokenRow : null
      if (ambientToken) {
        const siteUrl = await getSiteUrl()
        const siteHost = new URL(siteUrl).host
        for (const key of ['event_url', 'ticket_url', 'history_url', 'pickup_url']) {
          if (typeof data[key] === 'string') {
            data[key] = injectAmbientToken(data[key], ambientToken, siteHost)
          }
        }
      }
    } catch (err) {
      // Token mint failure is non-fatal — links still work, just without
      // recognition. Log so admin can spot a degraded state.
      console.error('mint_ambient_token failed:', err)
    }

    const template = messageTemplates[type]
    if (!template) {
      return new Response(JSON.stringify({ success: false, error: 'Unknown notification type' }), {
        status: 400,
        headers: jsonHeaders,
      })
    }

    const { subject, body, html } = template(data)
    // merge_verification requires sending to the specific channel that
    // owns the matched row (per spec §3.4 Case B). Other types fall back
    // to the guest's general preference.
    const forcedChannel: 'sms' | 'email' | null =
      data.channel === 'sms' || data.channel === 'email' ? data.channel : null
    const preference = forcedChannel || guest.notification_preference || 'email'
    let success = false
    let channel: 'sms' | 'email' = 'email'

    // Build the calendar attachment for confirmed/tentative RSVPs so
    // mail clients can offer one-click "Add to Calendar." Skipped for
    // waitlisted guests (their attendance is not actually scheduled)
    // and for non-RSVP message types. UID is stable per (event, guest)
    // so a re-RSVP updates the same calendar entry instead of creating
    // a duplicate one.
    let attachments: EmailAttachment[] | undefined
    if (
      type === 'rsvp_confirmation' &&
      eventRow &&
      eventId &&
      (data.status === 'yes' || data.status === 'maybe')
    ) {
      const ics = buildIcs({
        uid: `rsvp-${eventId}-${guestId}@cafekadhem.com`,
        summary: eventRow.title,
        description: `Your RSVP for ${eventRow.title}.${data.event_url ? `\n\nDetails: ${data.event_url}` : ''}`,
        location: eventRow.location_name
          ? `${eventRow.location_name}, ${eventRow.location}`
          : eventRow.location,
        date: eventRow.date,
        startTime: eventRow.start_time,
        endTime: eventRow.end_time,
        url: data.event_url || '',
        status: data.status === 'yes' ? 'CONFIRMED' : 'TENTATIVE',
      })
      attachments = [
        {
          filename: 'event.ics',
          content: utf8ToBase64(ics),
          contentType: 'text/calendar; method=PUBLISH; charset=UTF-8',
        },
      ]
    }

    // Per-type routing for guests with preference='both'. Time-sensitive
    // sends go SMS (if phone available + sms_enabled), bulkier or less
    // urgent sends go email. USER_FLOWS_SPEC.md §7.1.
    const BOTH_PREFERS_SMS: Record<string, boolean> = {
      rsvp_confirmation: true,
      ticket_issued: true,
      invite: true,
      event_reminder: true,
      waitlist_promoted: true,
      merge_verification: false,    // forced channel per §3.4 — never falls here
      order_confirmation: false,
      pickup_order_confirmation: false,
      event_update: false,
    }

    // Resolve sms_enabled (the global toggle from admin_settings).
    let smsEnabled = false
    {
      const { data: settings } = await supabase
        .from('admin_settings')
        .select('sms_enabled')
        .limit(1)
        .single()
      smsEnabled = !!settings?.sms_enabled
    }

    if (preference === 'none') {
      // Guest opted out — log and skip.
      await supabase.from('notifications_log').insert({
        guest_id: guestId,
        event_id: eventId,
        channel: 'email',  // placeholder — nothing was sent
        type,
        status: 'queued',  // existing CHECK only allows sent/failed/queued; 'queued' here means "suppressed"
        dedup_key: data.dedup_key ?? null,
        sent_at: null,
        error: 'suppressed: notification_preference=none',
      })
      return new Response(JSON.stringify({ success: true, channel: 'none', skipped: true }), {
        headers: jsonHeaders,
      })
    }

    // Pre-send idempotency check: if caller passed a dedup_key and a
    // 'sent' row already exists, skip the actual provider call. Without
    // this, a retry would log a duplicate but still fire the SMS/email.
    if (data.dedup_key) {
      const { data: existing } = await supabase
        .from('notifications_log')
        .select('id, status')
        .eq('dedup_key', data.dedup_key)
        .limit(1)
        .maybeSingle()
      if (existing && existing.status === 'sent') {
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: 'dedup' }),
          { headers: jsonHeaders },
        )
      }
    }

    if (preference === 'sms' && guest.phone && smsEnabled) {
      channel = 'sms'
      success = await sendSMS(guest.phone, body)
    } else if (preference === 'sms' && guest.email) {
      // SMS preferred but globally disabled → fall back to email.
      channel = 'email'
      success = await sendEmail(guest.email, subject, body, html, attachments)
    } else if (preference === 'email' && guest.email) {
      channel = 'email'
      success = await sendEmail(guest.email, subject, body, html, attachments)
    } else if (preference === 'both') {
      const wantsSms = BOTH_PREFERS_SMS[type] ?? false
      if (wantsSms && smsEnabled && guest.phone) {
        channel = 'sms'
        success = await sendSMS(guest.phone, body)
      } else if (guest.email) {
        channel = 'email'
        success = await sendEmail(guest.email, subject, body, html, attachments)
      } else if (smsEnabled && guest.phone) {
        channel = 'sms'
        success = await sendSMS(guest.phone, body)
      }
    } else {
      // Last-resort fallback: try email first, then SMS.
      if (guest.email) {
        channel = 'email'
        success = await sendEmail(guest.email, subject, body, html, attachments)
      } else if (smsEnabled && guest.phone) {
        channel = 'sms'
        success = await sendSMS(guest.phone, body)
      }
    }

    // Log notification. dedup_key is optional; when present the partial
    // unique index on notifications_log catches double-sends.
    // ON CONFLICT DO NOTHING so a duplicate (caller hit retry) is a
    // safe no-op. USER_FLOWS_SPEC.md §7.2.
    if (data.dedup_key) {
      await supabase.from('notifications_log').upsert(
        {
          guest_id: guestId,
          event_id: eventId,
          channel,
          type,
          status: success ? 'sent' : 'failed',
          dedup_key: data.dedup_key,
          sent_at: success ? new Date().toISOString() : null,
          error: success ? null : 'Send failed',
        },
        { onConflict: 'dedup_key', ignoreDuplicates: true },
      )
    } else {
      await supabase.from('notifications_log').insert({
        guest_id: guestId,
        event_id: eventId,
        channel,
        type,
        status: success ? 'sent' : 'failed',
        sent_at: success ? new Date().toISOString() : null,
        error: success ? null : 'Send failed',
      })
    }

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
