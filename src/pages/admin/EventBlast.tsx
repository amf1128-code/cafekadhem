import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Event, NotificationBlast } from '../../lib/types'
import { formatDate, formatTime } from '../../lib/utils/date'
import { useToast } from '../../components/ui/Toast'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/LoadingSpinner'

type Audience = NotificationBlast['audience']

const AUDIENCE_LABELS: Record<Audience, string> = {
  yes_only: 'All RSVPs (confirmed yes)',
  yes_and_maybe: 'RSVPs + Maybes',
  all_invited: 'Everyone invited (all statuses)',
}

const SMS_LIMIT = 160

export function AdminEventBlast() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()

  const [event, setEvent] = useState<Event | null>(null)
  const [blasts, setBlasts] = useState<NotificationBlast[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  // Form state
  const [audience, setAudience] = useState<Audience>('yes_only')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [smsBody, setSmsBody] = useState('')
  const [rsvpCounts, setRsvpCounts] = useState({ yes: 0, maybe: 0, all: 0 })

  useEffect(() => {
    if (id) loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadData() {
    setLoading(true)
    const [eventRes, blastsRes, yesRes, maybeRes, allRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', id!).single(),
      supabase
        .from('notification_blasts')
        .select('*')
        .eq('event_id', id!)
        .order('created_at', { ascending: false }),
      supabase
        .from('rsvps')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', id!)
        .eq('status', 'yes')
        .is('plus_one_of', null),
      supabase
        .from('rsvps')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', id!)
        .eq('status', 'maybe')
        .is('plus_one_of', null),
      supabase
        .from('rsvps')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', id!)
        .is('plus_one_of', null),
    ])
    setEvent(eventRes.data)
    setBlasts(blastsRes.data || [])
    setRsvpCounts({
      yes: yesRes.count || 0,
      maybe: maybeRes.count || 0,
      all: allRes.count || 0,
    })
    setLoading(false)
  }

  function recipientCount(): number {
    if (audience === 'yes_only') return rsvpCounts.yes
    if (audience === 'yes_and_maybe') return rsvpCounts.yes + rsvpCounts.maybe
    return rsvpCounts.all
  }

  async function handleSend() {
    if (!emailSubject.trim() || !emailBody.trim() || !smsBody.trim()) {
      addToast('Please fill in all fields', 'error')
      return
    }

    const count = recipientCount()
    if (count === 0) {
      addToast('No recipients match the selected audience', 'error')
      return
    }

    if (
      !confirm(
        `Send this blast to ${count} recipient${count === 1 ? '' : 's'}? This cannot be undone.`
      )
    ) {
      return
    }

    setSending(true)
    try {
      // Create the blast record
      const { data: blast, error: insertErr } = await supabase
        .from('notification_blasts')
        .insert({
          event_id: id,
          audience,
          email_subject: emailSubject.trim(),
          email_body: emailBody.trim(),
          sms_body: smsBody.trim(),
          status: 'pending',
        })
        .select('id')
        .single()

      if (insertErr || !blast) throw insertErr || new Error('Failed to create blast record')

      // Get the current session token so the edge function can verify admin auth
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) throw new Error('No active session')

      const res = await supabase.functions.invoke('send-blast', {
        body: { blast_id: blast.id },
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.error) throw res.error

      const result = res.data as { success: boolean; sent: number; failed: number }
      if (result.success) {
        const msg =
          result.failed === 0
            ? `Sent to ${result.sent} recipient${result.sent === 1 ? '' : 's'}`
            : `Sent ${result.sent} · Failed ${result.failed}`
        addToast(msg, result.failed > 0 ? 'error' : 'success')
        // Reset form
        setEmailSubject('')
        setEmailBody('')
        setSmsBody('')
        setAudience('yes_only')
      } else {
        throw new Error('Blast returned success=false')
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to send blast', 'error')
    } finally {
      setSending(false)
      loadData()
    }
  }

  if (loading) return <PageLoader />
  if (!event) {
    return (
      <div className="text-center py-16">
        <p className="text-ink/60">Event not found.</p>
      </div>
    )
  }

  const count = recipientCount()

  return (
    <div>
      <div className="mb-6">
        <Link to={`/admin/events/${event.id}/edit`} className="text-sm text-forest hover:underline">
          ← Back to event
        </Link>
        <h1 className="font-serif text-2xl text-forest-dark mt-2">
          Notification Blast: {event.title}
        </h1>
        <p className="text-sm text-ink/60">
          {formatDate(event.date)} at {formatTime(event.start_time)}
        </p>
      </div>

      {/* Compose form */}
      <div className="bg-white border border-warm rounded-lg p-6 mb-6">
        <h2 className="font-serif text-lg text-forest-dark mb-4">Compose Blast</h2>

        {/* Audience */}
        <div className="mb-5">
          <p className="text-sm font-medium text-ink/80 mb-2">Send to</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(AUDIENCE_LABELS) as Audience[]).map(a => (
              <button
                key={a}
                type="button"
                onClick={() => setAudience(a)}
                className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                  audience === a
                    ? 'border-forest bg-forest text-cream'
                    : 'border-warm text-ink/70 hover:border-forest hover:text-forest'
                }`}
              >
                {AUDIENCE_LABELS[a]}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink/50 mt-2">
            {count === 0
              ? 'No guests match this audience.'
              : `${count} recipient${count === 1 ? '' : 's'} will receive this blast.`}
          </p>
        </div>

        {/* Email copy */}
        <div className="mb-5">
          <p className="text-sm font-medium text-ink/80 mb-1">Email subject</p>
          <Input
            value={emailSubject}
            onChange={e => setEmailSubject(e.target.value)}
            placeholder={`Update about ${event.title}`}
          />
        </div>

        <div className="mb-5">
          <div className="flex justify-between items-baseline mb-1">
            <p className="text-sm font-medium text-ink/80">Email body</p>
            <p className="text-xs text-ink/40">Event link appended automatically</p>
          </div>
          <textarea
            value={emailBody}
            onChange={e => setEmailBody(e.target.value)}
            rows={6}
            placeholder={`Write your message here. It will appear in a branded Cafe Kadhem email template with a "View Event" button linking back to this event.`}
            className="w-full rounded-lg border border-warm bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-forest/30 resize-y"
          />
        </div>

        {/* SMS copy */}
        <div className="mb-6">
          <div className="flex justify-between items-baseline mb-1">
            <p className="text-sm font-medium text-ink/80">SMS body</p>
            <p className={`text-xs ${smsBody.length > SMS_LIMIT ? 'text-amber-600' : 'text-ink/40'}`}>
              {smsBody.length}/{SMS_LIMIT} · Event link appended automatically
            </p>
          </div>
          <textarea
            value={smsBody}
            onChange={e => setSmsBody(e.target.value)}
            rows={3}
            placeholder="Short message for SMS recipients. Keep it concise."
            className="w-full rounded-lg border border-warm bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-forest/30 resize-y"
          />
          {smsBody.length > SMS_LIMIT && (
            <p className="text-xs text-amber-600 mt-1">
              Over 160 characters — this will be delivered as multiple SMS segments.
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleSend}
            disabled={sending || !emailSubject.trim() || !emailBody.trim() || !smsBody.trim()}
            loading={sending}
          >
            {sending ? 'Sending…' : `Send blast${count > 0 ? ` to ${count}` : ''}`}
          </Button>
        </div>
      </div>

      {/* Previous blasts */}
      <div>
        <h2 className="font-serif text-lg text-forest-dark mb-3">Previous Blasts</h2>
        {blasts.length === 0 ? (
          <div className="bg-white border border-warm rounded-lg p-8 text-center">
            <p className="text-ink/50 italic">No blasts sent yet for this event.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {blasts.map(blast => (
              <BlastCard key={blast.id} blast={blast} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BlastCard({ blast }: { blast: NotificationBlast }) {
  const [expanded, setExpanded] = useState(false)

  const statusVariant: Record<NotificationBlast['status'], 'default' | 'success' | 'warning' | 'error' | 'info'> = {
    pending: 'warning',
    sending: 'warning',
    sent: 'success',
    failed: 'error',
  }

  return (
    <div className="bg-white border border-warm rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-warm/20 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-ink truncate">{blast.email_subject}</span>
            <Badge variant={statusVariant[blast.status]}>{blast.status}</Badge>
          </div>
          <p className="text-xs text-ink/50">
            {AUDIENCE_LABELS[blast.audience]} ·{' '}
            {blast.sent_at
              ? new Date(blast.sent_at).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })
              : new Date(blast.created_at).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
            {(blast.status === 'sent' || blast.status === 'failed') && (
              <> · {blast.sent_count} sent{blast.failed_count > 0 ? `, ${blast.failed_count} failed` : ''}</>
            )}
          </p>
        </div>
        <span className="text-ink/30 text-sm select-none pt-0.5">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-warm px-5 py-4 space-y-4">
          <div>
            <p className="text-xs font-medium text-ink/50 uppercase tracking-wider mb-1">Email body</p>
            <p className="text-sm text-ink whitespace-pre-wrap">{blast.email_body}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-ink/50 uppercase tracking-wider mb-1">SMS body</p>
            <p className="text-sm text-ink whitespace-pre-wrap">{blast.sms_body}</p>
          </div>
        </div>
      )}
    </div>
  )
}

