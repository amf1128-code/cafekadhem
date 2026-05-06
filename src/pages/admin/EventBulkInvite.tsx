import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Event, Guest } from '../../lib/types'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { formatPhone } from '../../lib/utils/phone'
import { formatDate } from '../../lib/utils/date'

type Mode = 'all' | 'past_event' | 'manual'

interface GuestRow extends Guest {
  rsvp_count: number
}

export function AdminEventBulkInvite() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [event, setEvent] = useState<Event | null>(null)
  const [pastEvents, setPastEvents] = useState<Event[]>([])
  const [guests, setGuests] = useState<GuestRow[]>([])
  const [eventGuestIds, setEventGuestIds] = useState<Map<string, Set<string>>>(new Map())
  const [alreadyInvited, setAlreadyInvited] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('all')
  const [pastEventId, setPastEventId] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [smsEnabled, setSmsEnabled] = useState(false)

  // Preview/confirm/resume state. `phase` drives which section renders.
  // 'browse' = guest picker visible.
  // 'preview' = job created, categorization shown; admin can confirm or back out.
  // 'sending' = confirm fired, polling recipients for progress.
  // 'done' = job completed; summary + Retry Failed button if any failed.
  type Phase = 'browse' | 'preview' | 'sending' | 'done'
  type RecipientRow = {
    id: string
    guest_id: string | null
    channel: 'sms' | 'email' | null
    resolved_email: string | null
    resolved_phone: string | null
    status: 'pending' | 'will_send' | 'sent' | 'failed' | 'skipped'
    skip_reason: string | null
    error: string | null
  }
  const [phase, setPhase] = useState<Phase>('browse')
  const [jobId, setJobId] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<RecipientRow[]>([])
  const [pastJobs, setPastJobs] = useState<Array<{ id: string; status: string; total_recipients: number; created_at: string; completed_at: string | null }>>([])

  useEffect(() => {
    if (id) loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadData() {
    setLoading(true)

    const [eventRes, eventsRes, guestsRes, rsvpsRes, invitesRes, settingsRes, jobsRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', id!).single(),
      supabase.from('events').select('*').neq('id', id!).order('date', { ascending: false }),
      supabase.from('guests').select('*').order('first_name'),
      supabase.from('rsvps').select('event_id, guest_id'),
      supabase.from('invites').select('invited_email, invited_phone').eq('event_id', id!),
      supabase.from('admin_settings').select('sms_enabled').limit(1).single(),
      supabase.from('bulk_invite_jobs').select('id, status, total_recipients, created_at, completed_at').eq('event_id', id!).order('created_at', { ascending: false }).limit(10),
    ])

    setPastJobs(jobsRes.data ?? [])

    setEvent(eventRes.data)
    setPastEvents(eventsRes.data || [])
    setSmsEnabled(!!settingsRes.data?.sms_enabled)

    const rsvpCount = new Map<string, number>()
    const byEvent = new Map<string, Set<string>>()
    for (const r of rsvpsRes.data || []) {
      rsvpCount.set(r.guest_id, (rsvpCount.get(r.guest_id) || 0) + 1)
      let set = byEvent.get(r.event_id)
      if (!set) {
        set = new Set()
        byEvent.set(r.event_id, set)
      }
      set.add(r.guest_id)
    }
    setEventGuestIds(byEvent)

    const guestRows: GuestRow[] = (guestsRes.data || []).map(g => ({
      ...g,
      rsvp_count: rsvpCount.get(g.id) || 0,
    }))
    setGuests(guestRows)

    const invitedSet = new Set<string>()
    for (const inv of invitesRes.data || []) {
      if (inv.invited_email) invitedSet.add(`e:${inv.invited_email.toLowerCase()}`)
      if (inv.invited_phone) invitedSet.add(`p:${inv.invited_phone}`)
    }
    setAlreadyInvited(invitedSet)

    setLoading(false)
  }

  // The candidate pool (before checkbox selection) depends on mode.
  const candidates = useMemo<GuestRow[]>(() => {
    let pool: GuestRow[] = []
    if (mode === 'all') {
      pool = guests.filter(g => g.rsvp_count > 0)
    } else if (mode === 'past_event') {
      const ids = pastEventId ? eventGuestIds.get(pastEventId) : null
      pool = ids ? guests.filter(g => ids.has(g.id)) : []
    } else {
      pool = guests
    }
    if (!search) return pool
    const s = search.toLowerCase()
    return pool.filter(g =>
      g.first_name.toLowerCase().includes(s) ||
      (g.last_name || '').toLowerCase().includes(s) ||
      (g.email || '').toLowerCase().includes(s) ||
      (g.phone || '').includes(s)
    )
  }, [mode, pastEventId, search, guests, eventGuestIds])

  function isContactable(g: GuestRow): boolean {
    // While SMS is disabled, phone-only guests have no reachable channel
    // and are treated as non-contactable so the admin can't accidentally
    // queue an invite that would silently get dropped.
    return !!g.email || (smsEnabled && !!g.phone)
  }

  function wasInvited(g: GuestRow): boolean {
    if (g.email && alreadyInvited.has(`e:${g.email.toLowerCase()}`)) return true
    if (g.phone && alreadyInvited.has(`p:${g.phone}`)) return true
    return false
  }

  function toggle(guestId: string) {
    const next = new Set(selected)
    if (next.has(guestId)) next.delete(guestId)
    else next.add(guestId)
    setSelected(next)
  }

  function selectAllVisible() {
    const next = new Set(selected)
    for (const g of candidates) {
      if (isContactable(g) && !wasInvited(g)) next.add(g.id)
    }
    setSelected(next)
  }

  function clearSelection() {
    setSelected(new Set())
  }

  // New preview/confirm/resume flow.
  // 1. handleStartPreview: invoke bulk-invite preview, show categorization.
  // 2. handleConfirmSend: invoke bulk-invite confirm, poll for progress.
  // 3. After completion: summary + retry-failed if any failed.

  async function loadRecipients(jid: string): Promise<RecipientRow[]> {
    const { data } = await supabase
      .from('bulk_invite_job_recipients')
      .select('id, guest_id, channel, resolved_email, resolved_phone, status, skip_reason, error')
      .eq('job_id', jid)
    return (data ?? []) as RecipientRow[]
  }

  async function handleStartPreview() {
    if (!event) return
    const targets = Array.from(selected)
    if (targets.length === 0) {
      addToast('No guests selected', 'error')
      return
    }
    setSending(true)
    try {
      const { data, error } = await supabase.functions.invoke('bulk-invite', {
        body: { action: 'preview', event_id: event.id, guest_ids: targets },
      })
      if (error) throw error
      const result = data as { job_id: string; will_send: number; total: number }
      setJobId(result.job_id)
      setRecipients(await loadRecipients(result.job_id))
      setPhase('preview')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Preview failed', 'error')
    } finally {
      setSending(false)
    }
  }

  async function handleConfirmSend() {
    if (!jobId) return
    setSending(true)
    setPhase('sending')
    try {
      // Fire confirm; the edge fn processes recipients sequentially.
      // We don't await — we poll the recipients table for live progress
      // and the edge fn will finalize the job row when done.
      void supabase.functions.invoke('bulk-invite', {
        body: { action: 'confirm', job_id: jobId },
      })
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Send failed', 'error')
      setSending(false)
    }
  }

  // Poll the recipients table while the job is sending.
  useEffect(() => {
    if (phase !== 'sending' || !jobId) return
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      const fresh = await loadRecipients(jobId)
      if (cancelled) return
      setRecipients(fresh)
      // Check job status
      const { data: jobRow } = await supabase
        .from('bulk_invite_jobs')
        .select('status, completed_at')
        .eq('id', jobId)
        .single()
      if (cancelled) return
      if (jobRow?.status === 'completed' || jobRow?.status === 'failed') {
        setPhase('done')
        setSending(false)
        return
      }
      setTimeout(tick, 1500)
    }
    tick()
    return () => {
      cancelled = true
    }
  }, [phase, jobId])

  async function handleRetryFailed() {
    if (!jobId) return
    setSending(true)
    try {
      const { data, error } = await supabase.functions.invoke('bulk-invite', {
        body: { action: 'retry_failed', job_id: jobId },
      })
      if (error) throw error
      const result = data as { job_id: string; will_send: number }
      setJobId(result.job_id)
      setRecipients(await loadRecipients(result.job_id))
      setPhase('preview')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Retry failed', 'error')
    } finally {
      setSending(false)
    }
  }

  function handleStartOver() {
    setPhase('browse')
    setJobId(null)
    setRecipients([])
    setSelected(new Set())
    void loadData()
  }

  if (loading) return <PageLoader />
  if (!event) {
    return (
      <div className="text-center py-16">
        <p className="text-ink/60">Event not found.</p>
      </div>
    )
  }

  const selectableCount = candidates.filter(g => isContactable(g) && !wasInvited(g)).length

  return (
    <div>
      <div className="mb-6">
        <Link to={`/admin/events/${event.id}/edit`} className="text-sm text-forest hover:underline">
          ← Back to event
        </Link>
        <h1 className="font-serif text-2xl text-forest-dark mt-2">Invite to: {event.title}</h1>
        <p className="text-sm text-ink/60">{formatDate(event.date)}</p>
      </div>

      {phase !== 'browse' && (
        <PhaseView
          phase={phase}
          recipients={recipients}
          guests={guests}
          sending={sending}
          onConfirm={handleConfirmSend}
          onRetryFailed={handleRetryFailed}
          onStartOver={handleStartOver}
          onBackToBrowse={() => setPhase('browse')}
        />
      )}

      {phase === 'browse' && pastJobs.length > 0 && (
        <div className="bg-white border border-warm rounded-lg p-4 mb-4">
          <p className="text-[10px] tracking-[0.2em] uppercase text-ink/60 mb-2">
            Previous bulk jobs
          </p>
          <div className="space-y-1">
            {pastJobs.map(j => (
              <div key={j.id} className="flex items-center gap-3 text-sm text-ink/70">
                <Badge variant={j.status === 'completed' ? 'success' : j.status === 'failed' ? 'error' : j.status === 'sending' ? 'warning' : 'default'}>
                  {j.status}
                </Badge>
                <span>{j.total_recipients} recipient{j.total_recipients === 1 ? '' : 's'}</span>
                <span className="text-ink/50">·</span>
                <span className="text-ink/50">{new Date(j.completed_at ?? j.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 'browse' && (<>
      <div className="bg-white border border-warm rounded-lg p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-4">
          <ModeButton current={mode} value="all" onClick={() => setMode('all')}>
            Everyone who's RSVP'd
          </ModeButton>
          <ModeButton current={mode} value="past_event" onClick={() => setMode('past_event')}>
            From a past event
          </ModeButton>
          <ModeButton current={mode} value="manual" onClick={() => setMode('manual')}>
            Manual checklist
          </ModeButton>
        </div>

        {mode === 'past_event' && (
          <div className="mb-3">
            <Select
              value={pastEventId}
              onChange={e => setPastEventId(e.target.value)}
              placeholder="Pick an event…"
              options={pastEvents.map(ev => ({
                value: ev.id,
                label: `${formatDate(ev.date)} — ${ev.title}`,
              }))}
            />
          </div>
        )}

        <Input
          placeholder="Filter by name, email, phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <p className="text-sm text-ink/70">
          {candidates.length} match{candidates.length === 1 ? '' : 'es'} ·
          {' '}{selectableCount} eligible · {selected.size} selected
        </p>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={selectAllVisible}>
            Select all eligible
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection} disabled={selected.size === 0}>
            Clear
          </Button>
        </div>
      </div>

      <div className="bg-white border border-warm rounded-lg overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm bg-warm/30">
              <th className="w-10 px-3 py-2"></th>
              <th className="text-left px-4 py-2 font-medium text-ink/70">Name</th>
              <th className="text-left px-4 py-2 font-medium text-ink/70">Contact</th>
              <th className="text-left px-4 py-2 font-medium text-ink/70">Events</th>
              <th className="text-left px-4 py-2 font-medium text-ink/70">Status</th>
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink/50 italic">
                  {mode === 'past_event' && !pastEventId
                    ? 'Pick an event above.'
                    : 'No matches.'}
                </td>
              </tr>
            ) : candidates.map(guest => {
              const contactable = isContactable(guest)
              const invited = wasInvited(guest)
              const disabled = !contactable || invited
              const checked = selected.has(guest.id)
              return (
                <tr
                  key={guest.id}
                  className={`border-b border-warm/50 last:border-0 ${disabled ? 'opacity-50' : ''}`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(guest.id)}
                      disabled={disabled}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{guest.first_name}</span>
                    {guest.last_name && <span className="text-ink/70"> {guest.last_name}</span>}
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    {guest.email && <div>{guest.email}</div>}
                    {guest.phone && <div className="text-xs">{formatPhone(guest.phone)}</div>}
                    {!contactable && <span className="text-xs italic">No contact</span>}
                  </td>
                  <td className="px-4 py-3 text-ink/60">{guest.rsvp_count}</td>
                  <td className="px-4 py-3 text-xs text-ink/60">
                    {invited ? 'Already invited' : !contactable ? '—' : 'Eligible'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-4 flex justify-end">
        <div className="bg-white border border-warm rounded-lg shadow-lg p-3 flex items-center gap-3">
          <Button
            onClick={handleStartPreview}
            disabled={sending || selected.size === 0}
            loading={sending}
          >
            Preview {selected.size > 0 ? `${selected.size} ` : ''}invite{selected.size === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
      </>)}
    </div>
  )
}

// ============================================================
// Phase: preview / sending / done. Renders categorized recipients
// with their will_send / skipped / sent / failed status, replacing
// the guest-picker table while a job is in flight.
// ============================================================
function PhaseView({
  phase,
  recipients,
  guests,
  sending,
  onConfirm,
  onRetryFailed,
  onStartOver,
  onBackToBrowse,
}: {
  phase: 'preview' | 'sending' | 'done'
  recipients: Array<{
    id: string
    guest_id: string | null
    channel: 'sms' | 'email' | null
    resolved_email: string | null
    resolved_phone: string | null
    status: 'pending' | 'will_send' | 'sent' | 'failed' | 'skipped'
    skip_reason: string | null
    error: string | null
  }>
  guests: GuestRow[]
  sending: boolean
  onConfirm: () => void
  onRetryFailed: () => void
  onStartOver: () => void
  onBackToBrowse: () => void
}) {
  const guestById = new Map(guests.map(g => [g.id, g]))
  const willSend = recipients.filter(r => r.status === 'will_send').length
  const skipped = recipients.filter(r => r.status === 'skipped')
  const sent = recipients.filter(r => r.status === 'sent').length
  const failed = recipients.filter(r => r.status === 'failed').length
  const inFlight = recipients.filter(r => r.status === 'will_send' || r.status === 'pending').length

  const headerLabel = phase === 'preview' ? 'Preview' : phase === 'sending' ? 'Sending…' : 'Done'

  return (
    <div className="space-y-4">
      <div className="bg-white border border-warm rounded-lg p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-serif text-lg text-forest-dark">{headerLabel}</h2>
            <p className="text-sm text-ink/70 mt-1">
              {phase === 'preview' && `${willSend} will send · ${skipped.length} skipped`}
              {phase === 'sending' && `${sent} sent · ${failed} failed · ${inFlight} pending`}
              {phase === 'done' && `${sent} sent · ${failed} failed${skipped.length > 0 ? ` · ${skipped.length} skipped` : ''}`}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {phase === 'preview' && (
              <>
                <Button variant="ghost" onClick={onBackToBrowse}>
                  Back
                </Button>
                <Button onClick={onConfirm} disabled={sending || willSend === 0} loading={sending}>
                  Send {willSend} invite{willSend === 1 ? '' : 's'}
                </Button>
              </>
            )}
            {phase === 'done' && (
              <>
                {failed > 0 && (
                  <Button variant="outline" onClick={onRetryFailed} loading={sending}>
                    Retry {failed} failed
                  </Button>
                )}
                <Button onClick={onStartOver}>Done</Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-warm rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm bg-warm/30">
              <th className="text-left px-4 py-2 font-medium text-ink/70">Guest</th>
              <th className="text-left px-4 py-2 font-medium text-ink/70">Channel</th>
              <th className="text-left px-4 py-2 font-medium text-ink/70">Status</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map(r => {
              const g = r.guest_id ? guestById.get(r.guest_id) : null
              const skipLabel: Record<string, string> = {
                guest_not_found: 'guest not found',
                opted_out: 'opted out (notification_preference=none)',
                no_reachable_channel: 'no reachable channel',
                recently_invited: 'invited in the last 24h',
              }
              return (
                <tr key={r.id} className="border-b border-warm/50 last:border-0">
                  <td className="px-4 py-3">
                    {g ? (
                      <span>
                        <span className="font-medium">{g.first_name}</span>
                        {g.last_name && <span className="text-ink/70"> {g.last_name}</span>}
                      </span>
                    ) : (
                      <span className="text-ink/50 italic">unknown guest</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    {r.channel === 'email' && r.resolved_email}
                    {r.channel === 'sms' && r.resolved_phone}
                    {!r.channel && '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        r.status === 'sent' ? 'success'
                        : r.status === 'failed' ? 'error'
                        : r.status === 'skipped' ? 'default'
                        : r.status === 'will_send' ? 'info'
                        : 'warning'
                      }
                    >
                      {r.status}
                    </Badge>
                    {r.skip_reason && (
                      <p className="text-xs text-ink/60 italic mt-1">
                        {skipLabel[r.skip_reason] ?? r.skip_reason}
                      </p>
                    )}
                    {r.error && (
                      <p className="text-xs text-red-700 italic mt-1">{r.error}</p>
                    )}
                  </td>
                </tr>
              )
            })}
            {recipients.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-ink/50 italic">
                  No recipients.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ModeButton({
  current,
  value,
  onClick,
  children,
}: {
  current: Mode
  value: Mode
  onClick: () => void
  children: React.ReactNode
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
        active
          ? 'border-forest bg-forest text-cream'
          : 'border-warm text-ink/70 hover:border-forest hover:text-forest'
      }`}
    >
      {children}
    </button>
  )
}
