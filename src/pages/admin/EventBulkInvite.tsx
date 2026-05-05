import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Event, Guest } from '../../lib/types'
import { sendInviteNotification } from '../../lib/notifications'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { Button } from '../../components/ui/Button'
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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [smsEnabled, setSmsEnabled] = useState(false)

  useEffect(() => {
    if (id) loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadData() {
    setLoading(true)

    const [eventRes, eventsRes, guestsRes, rsvpsRes, invitesRes, settingsRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', id!).single(),
      supabase.from('events').select('*').neq('id', id!).order('date', { ascending: false }),
      supabase.from('guests').select('*').order('first_name'),
      supabase.from('rsvps').select('event_id, guest_id'),
      supabase.from('invites').select('invited_email, invited_phone').eq('event_id', id!),
      supabase.from('admin_settings').select('sms_enabled').limit(1).single(),
    ])

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

  async function handleSend() {
    if (!event) return
    const targets = guests.filter(g => selected.has(g.id) && isContactable(g))
    if (targets.length === 0) {
      addToast('No selected guests have contact info', 'error')
      return
    }

    if (!confirm(`Send invites to ${targets.length} guest${targets.length === 1 ? '' : 's'}?`)) {
      return
    }

    setSending(true)
    setProgress({ done: 0, total: targets.length })
    let okCount = 0
    let failCount = 0

    for (const guest of targets) {
      try {
        // Pick email if available, else phone, matching their preference if
        // set. While SMS is disabled the phone branch is suppressed so an
        // invite never goes to a phone-only guest.
        const useEmail = guest.notification_preference === 'email'
          ? !!guest.email
          : guest.notification_preference === 'sms'
          ? !smsEnabled && !!guest.email
          : !!guest.email
        const contactInfo = useEmail
          ? { email: guest.email! }
          : smsEnabled && guest.phone
          ? { phone: guest.phone }
          : guest.email
          ? { email: guest.email }
          : null
        if (!contactInfo) {
          failCount++
          continue
        }

        const { data: invite } = await supabase
          .from('invites')
          .insert({
            event_id: event.id,
            invited_email: 'email' in contactInfo ? contactInfo.email : null,
            invited_phone: 'phone' in contactInfo ? contactInfo.phone : null,
          })
          .select('token')
          .single()

        if (!invite) {
          failCount++
          continue
        }

        const result = await sendInviteNotification(event.id, contactInfo, invite.token)
        if (result.success) okCount++
        else failCount++
      } catch {
        failCount++
      } finally {
        setProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null)
      }
    }

    setSending(false)
    setProgress(null)
    setSelected(new Set())
    addToast(
      failCount === 0
        ? `Sent ${okCount} invites`
        : `Sent ${okCount} · Failed ${failCount}`,
      failCount === 0 ? 'success' : 'error'
    )
    // Refresh the "already invited" set so the UI reflects the new sends.
    loadData()
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
          {progress && (
            <span className="text-sm text-ink/70">
              Sending {progress.done}/{progress.total}…
            </span>
          )}
          <Button onClick={handleSend} disabled={sending || selected.size === 0} loading={sending}>
            Send {selected.size > 0 ? `${selected.size} ` : ''}invite{selected.size === 1 ? '' : 's'}
          </Button>
        </div>
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
