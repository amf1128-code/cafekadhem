import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Event } from '../../lib/types'
import { formatDate, formatTime } from '../../lib/utils/date'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'

type Audience = 'yes_only' | 'yes_and_maybe' | 'all_invited'

type BlastRow = {
  id: string
  event_id: string
  audience: Audience
  email_subject: string
  email_body: string
  sms_body: string
  status: 'pending' | 'sending' | 'sent' | 'failed'
  sent_count: number
  failed_count: number
  sent_at: string | null
  created_at: string
}

const AUDIENCE_LABELS: Record<Audience, string> = {
  yes_only: 'Going (yes)',
  yes_and_maybe: 'Going + maybe',
  all_invited: 'All invited',
}

const STATUS_VARIANT: Record<BlastRow['status'], 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  pending: 'default',
  sending: 'warning',
  sent: 'success',
  failed: 'error',
}

export function AdminEventBlast() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [event, setEvent] = useState<Event | null>(null)
  const [audience, setAudience] = useState<Audience>('yes_only')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [smsBody, setSmsBody] = useState('')
  const [audienceCount, setAudienceCount] = useState(0)
  const [history, setHistory] = useState<BlastRow[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (id) loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadData() {
    const [eventRes, blastsRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', id!).single(),
      supabase
        .from('notification_blasts')
        .select('*')
        .eq('event_id', id!)
        .order('created_at', { ascending: false }),
    ])
    if (eventRes.data) setEvent(eventRes.data)
    if (blastsRes.data) setHistory(blastsRes.data as BlastRow[])
    setLoading(false)
  }

  // Recompute the recipient count whenever audience changes. Excludes:
  //   - plus-ones (no contact info of their own)
  //   - notification_preference='none' (suppression)
  //   - non-contactable (no email AND no phone OR phone-only when SMS off)
  // Deduplicated by guest_id in case a guest has multiple RSVP rows
  // (shouldn't happen, but the UNIQUE constraint is per (event, guest)
  // and merge_guests can leave plus-one stubs around).
  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      const statusFilter =
        audience === 'yes_only' ? ['yes']
        : audience === 'yes_and_maybe' ? ['yes', 'maybe']
        : ['yes', 'maybe', 'no', 'waitlisted']

      const [rsvpsRes, settingsRes] = await Promise.all([
        supabase
          .from('rsvps')
          .select('guest_id, guests!guest_id(id, email, phone, notification_preference)')
          .eq('event_id', id)
          .is('plus_one_of', null)
          .in('status', statusFilter),
        supabase.from('admin_settings').select('sms_enabled').limit(1).single(),
      ])
      if (cancelled) return
      const smsEnabled = !!settingsRes.data?.sms_enabled
      const seen = new Set<string>()
      let count = 0
      type EmbeddedGuest = {
        id: string
        email: string | null
        phone: string | null
        notification_preference: string | null
      }
      for (const r of (rsvpsRes.data ?? []) as unknown as Array<{ guests: EmbeddedGuest | EmbeddedGuest[] | null }>) {
        // PostgREST returns nested resources as either an object or an array
        // depending on the relationship cardinality and version. Normalize.
        const g = Array.isArray(r.guests) ? r.guests[0] : r.guests
        if (!g) continue
        if (seen.has(g.id)) continue
        seen.add(g.id)
        if (g.notification_preference === 'none') continue
        const reachable = !!g.email || (smsEnabled && !!g.phone)
        if (!reachable) continue
        count++
      }
      setAudienceCount(count)
    })()
    return () => {
      cancelled = true
    }
  }, [id, audience])

  const smsLength = smsBody.length
  const smsOverLimit = smsLength > 160

  const canSend = useMemo(() => {
    return (
      !!emailSubject.trim() &&
      !!emailBody.trim() &&
      !!smsBody.trim() &&
      audienceCount > 0 &&
      !sending
    )
  }, [emailSubject, emailBody, smsBody, audienceCount, sending])

  async function handleSend() {
    if (!event || !canSend) return
    if (!confirm(`Send blast to ${audienceCount} recipient${audienceCount === 1 ? '' : 's'}? This cannot be undone.`)) {
      return
    }

    setSending(true)
    try {
      // 1. Insert the blast row.
      const { data: created, error: insertErr } = await supabase
        .from('notification_blasts')
        .insert({
          event_id: event.id,
          audience,
          email_subject: emailSubject.trim(),
          email_body: emailBody.trim(),
          sms_body: smsBody.trim(),
        })
        .select('id')
        .single()
      if (insertErr || !created) throw insertErr || new Error('insert failed')

      // 2. Invoke the edge function — it uses our session JWT for auth.
      const { data: result, error: invokeErr } = await supabase.functions.invoke('send-blast', {
        body: { blast_id: created.id },
      })
      if (invokeErr) throw invokeErr

      const sent = (result as { sent?: number; failed?: number })?.sent ?? 0
      const failed = (result as { sent?: number; failed?: number })?.failed ?? 0
      addToast(`Blast sent — ${sent} delivered${failed > 0 ? `, ${failed} failed` : ''}`)

      // Reset compose form, refresh history.
      setEmailSubject('')
      setEmailBody('')
      setSmsBody('')
      await loadData()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Blast failed', 'error')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <PageLoader />
  if (!event) return <p className="text-ink/60">Event not found.</p>

  return (
    <div className="space-y-8">
      <div>
        <Link
          to={`/admin/events/${id}/edit`}
          className="text-xs tracking-[0.2em] uppercase text-ink/60 hover:text-forest transition-colors"
        >
          ← Back to event
        </Link>
        <h1 className="font-serif text-2xl text-forest-dark mt-2">
          {event.title} — Blast
        </h1>
        <p className="text-sm text-ink/60">
          {formatDate(event.date)} at {formatTime(event.start_time)}
        </p>
      </div>

      {/* Compose form */}
      <div className="bg-white border border-warm rounded-lg p-6 space-y-5">
        <h2 className="font-serif text-lg text-forest-dark">New blast</h2>

        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-ink/60 mb-2">
            Audience
          </label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setAudience(opt)}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  audience === opt
                    ? 'bg-forest text-cream border-forest'
                    : 'bg-white border-warm text-ink/70 hover:border-forest'
                }`}
              >
                {AUDIENCE_LABELS[opt]}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink/60 mt-2">
            <span className="font-medium">{audienceCount}</span> recipient{audienceCount === 1 ? '' : 's'} will receive this blast.
          </p>
        </div>

        <Input
          label="Email subject"
          value={emailSubject}
          onChange={(e) => setEmailSubject(e.target.value)}
          placeholder="A quick update about the event"
        />

        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-ink/60 mb-2">
            Email body
          </label>
          <textarea
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            rows={6}
            className="w-full border border-warm rounded-lg bg-cream px-3 py-2 text-sm font-serif text-ink resize-y outline-none focus:border-forest"
            placeholder="What you want to say to people who are coming."
          />
          <p className="text-xs text-ink/50 mt-1">
            Event link is appended automatically.
          </p>
        </div>

        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-ink/60 mb-2">
            SMS body
          </label>
          <textarea
            value={smsBody}
            onChange={(e) => setSmsBody(e.target.value)}
            rows={3}
            className="w-full border border-warm rounded-lg bg-cream px-3 py-2 text-sm font-serif text-ink resize-y outline-none focus:border-forest"
            placeholder="Shorter version for text recipients."
          />
          <div className="flex justify-between text-xs mt-1">
            <span className="text-ink/50">Event link is appended automatically.</span>
            <span className={smsOverLimit ? 'text-red-700' : 'text-ink/50'}>
              {smsLength}/160{smsOverLimit ? ' (multi-segment)' : ''}
            </span>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSend}
            disabled={!canSend}
            loading={sending}
          >
            Send blast to {audienceCount}
          </Button>
        </div>
      </div>

      {/* Previous blasts */}
      <div>
        <h2 className="font-serif text-lg text-forest-dark mb-3">Previous blasts</h2>
        {history.length === 0 ? (
          <div className="bg-white border border-warm rounded-lg p-6 text-center text-ink/60 text-sm">
            No blasts sent yet for this event.
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((b) => {
              const expanded = expandedId === b.id
              return (
                <div key={b.id} className="bg-white border border-warm rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : b.id)}
                    className="w-full text-left p-4 hover:bg-warm/20 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-ink truncate">{b.email_subject}</p>
                        <p className="text-xs text-ink/60 mt-1">
                          {AUDIENCE_LABELS[b.audience]} ·{' '}
                          {b.sent_at
                            ? new Date(b.sent_at).toLocaleString()
                            : new Date(b.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={STATUS_VARIANT[b.status]}>{b.status}</Badge>
                        {(b.sent_count > 0 || b.failed_count > 0) && (
                          <span className="text-xs text-ink/60">
                            {b.sent_count} sent{b.failed_count > 0 ? `, ${b.failed_count} failed` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  {expanded && (
                    <div className="border-t border-warm p-4 space-y-4 bg-warm/10">
                      <div>
                        <p className="text-[10px] tracking-[0.2em] uppercase text-ink/60 mb-1">Email</p>
                        <p className="text-sm font-medium text-ink mb-1">{b.email_subject}</p>
                        <p className="text-sm text-ink/80 whitespace-pre-wrap">{b.email_body}</p>
                      </div>
                      <div>
                        <p className="text-[10px] tracking-[0.2em] uppercase text-ink/60 mb-1">SMS</p>
                        <p className="text-sm text-ink/80 whitespace-pre-wrap">{b.sms_body}</p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
