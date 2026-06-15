import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import type { Event, CheckInResult } from '../../lib/types'
import { formatDate, formatTime } from '../../lib/utils/date'
import { formatPhone } from '../../lib/utils/phone'
import {
  tokenFromValue,
  needsPayment,
  visibleAttendees,
  type AttendeeRow,
} from '../../lib/utils/door'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Input, Textarea } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { VenmoQrModal } from '../../components/tickets/VenmoQrModal'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'

interface DoorSettings {
  venmo_handle: string
  venmo_qr_url: string | null
}

interface ScanFeedback {
  kind: 'success' | 'already' | 'error'
  message: string
  guestName?: string
  notes?: string | null
  unpaid?: boolean
  at?: number
}

const SCANNER_ID = 'kadhem-qr-scanner'

export function AdminEventCheckIn() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [event, setEvent] = useState<Event | null>(null)
  const [settings, setSettings] = useState<DoorSettings | null>(null)
  const [attendees, setAttendees] = useState<AttendeeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [scanning, setScanning] = useState(false)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const [busyRow, setBusyRow] = useState<string | null>(null)

  // Inline note editing.
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  // Manual code entry (camera-fail fallback) + walk-in + QR modals.
  const [manualToken, setManualToken] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [qrFor, setQrFor] = useState<{ name?: string } | null>(null)

  // Door QR (capacity-bypass walk-in link) modal.
  const [doorOpen, setDoorOpen] = useState(false)
  const [doorQr, setDoorQr] = useState<{ url: string; image: string } | null>(null)
  const [doorBusy, setDoorBusy] = useState(false)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastScanRef = useRef<{ token: string; at: number } | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    if (id) loadData()
    return () => {
      stopScanner()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadData() {
    // Load EVERY rsvp for the event (all statuses, plus-ones included) so
    // the door can find anyone — paid or not, registered or not. Full
    // guest record is admin-readable, used for search + disambiguation.
    const [eventResult, rsvpResult, settingsResult] = await Promise.all([
      supabase.from('events').select('*').eq('id', id!).single(),
      supabase
        .from('rsvps')
        .select('*, guest:guests!guest_id(*)')
        .eq('event_id', id!)
        .order('created_at', { ascending: true }),
      supabase.from('admin_settings').select('venmo_handle, venmo_qr_url').limit(1).single(),
    ])
    if (eventResult.data) setEvent(eventResult.data)
    if (rsvpResult.data) setAttendees(rsvpResult.data as AttendeeRow[])
    if (settingsResult.data) setSettings(settingsResult.data as DoorSettings)
    setLoading(false)
  }

  // ---- Door QR (capacity-bypass walk-in link) ----------------------------
  async function buildDoorQr(tok: string) {
    const url = `${window.location.origin}/door/${tok}`
    const image = await QRCode.toDataURL(url, {
      margin: 1,
      width: 480,
      color: { dark: '#0d0d0f', light: '#f4ecd8' },
    })
    setDoorQr({ url, image })
  }

  async function openDoorQr() {
    setDoorOpen(true)
    if (doorQr) return
    setDoorBusy(true)
    try {
      let tok = event?.door_token || null
      if (!tok) {
        const { data, error } = await supabase.rpc('mint_door_token', { p_event_id: id! })
        if (error) throw error
        tok = data as string
        setEvent(e => (e ? { ...e, door_token: tok } : e))
      }
      await buildDoorQr(tok)
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not create door QR', 'error')
    } finally {
      setDoorBusy(false)
    }
  }

  async function rotateDoorToken() {
    if (!confirm('Generate a new door QR? The current one stops working immediately.')) return
    setDoorBusy(true)
    try {
      const { data, error } = await supabase.rpc('mint_door_token', { p_event_id: id! })
      if (error) throw error
      const tok = data as string
      setEvent(e => (e ? { ...e, door_token: tok } : e))
      await buildDoorQr(tok)
      addToast('New door QR generated')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not rotate the code', 'error')
    } finally {
      setDoorBusy(false)
    }
  }

  // Map a plus-one rsvp id -> its host's first name, for the "+1 of X" tag.
  const hostNameByRsvpId = useMemo(() => {
    const byId = new Map(attendees.map(r => [r.id, r]))
    const map = new Map<string, string>()
    for (const r of attendees) {
      if (r.plus_one_of) {
        const host = byId.get(r.plus_one_of)
        if (host) map.set(r.id, host.guest.first_name)
      }
    }
    return map
  }, [attendees])

  // ---- Scanner check-in (paid tickets only — a token implies payment) ----
  async function performCheckIn(token: string) {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const { data, error } = await supabase.rpc('check_in_ticket', { p_token: token })
      if (error) throw error
      const result = data as CheckInResult
      if (!result.success) {
        setFeedback({ kind: 'error', message: result.error || 'Invalid ticket' })
        return
      }
      showResult(result)
      await loadData()
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Scan failed',
      })
    } finally {
      busyRef.current = false
    }
  }

  function showResult(result: CheckInResult) {
    const name = `${result.guest_first_name || ''}${
      result.guest_last_name ? ' ' + result.guest_last_name : ''
    }`.trim()
    setFeedback({
      kind: result.already_checked_in ? 'already' : 'success',
      message: result.already_checked_in ? 'Already checked in' : 'Welcome',
      guestName: name,
      notes: result.notes,
      unpaid: result.payment_status !== 'paid' && result.payment_status !== 'pending',
      at: result.checked_in_at ? new Date(result.checked_in_at).getTime() : undefined,
    })
  }

  async function handleManualToken(e: FormEvent) {
    e.preventDefault()
    const token = tokenFromValue(manualToken)
    if (!token) {
      addToast('That doesn’t look like a ticket code or link', 'error')
      return
    }
    await performCheckIn(token)
    setManualToken('')
  }

  // ---- Row check-in (works for any payment status: paid, comp, walk-in) ----
  async function handleRowCheckIn(row: AttendeeRow) {
    setBusyRow(row.id)
    try {
      const { data, error } = await supabase.rpc('door_check_in', { p_rsvp_id: row.id })
      if (error) throw error
      const result = data as CheckInResult
      if (!result.success) {
        addToast(result.error || 'Could not check in', 'error')
        return
      }
      showResult(result)
      await loadData()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Check-in failed', 'error')
    } finally {
      setBusyRow(null)
    }
  }

  async function handleUndo(rsvpId: string) {
    if (!confirm('Undo this check-in?')) return
    setBusyRow(rsvpId)
    const { error } = await supabase.rpc('undo_check_in', { p_rsvp_id: rsvpId })
    setBusyRow(null)
    if (error) {
      addToast(error.message, 'error')
      return
    }
    addToast('Check-in reverted')
    if (feedback) setFeedback(null)
    await loadData()
  }

  // Collect payment at the door: marks paid (issuing a ticket token) so the
  // guest also gets a valid digital ticket for next time.
  async function handleMarkPaid(row: AttendeeRow) {
    setBusyRow(row.id)
    try {
      const { error } = await supabase.rpc('mark_rsvp_paid', { p_rsvp_id: row.id })
      if (error) throw error
      addToast(`${row.guest.first_name} marked paid`)
      await loadData()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to mark paid', 'error')
    } finally {
      setBusyRow(null)
    }
  }

  async function saveNote(row: AttendeeRow) {
    const value = noteDraft.trim() || null
    setBusyRow(row.id)
    try {
      const { error } = await supabase.from('rsvps').update({ notes: value }).eq('id', row.id)
      if (error) throw error
      setEditingNote(null)
      setNoteDraft('')
      await loadData()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save note', 'error')
    } finally {
      setBusyRow(null)
    }
  }

  // ---- Scanner lifecycle --------------------------------------------------
  async function startScanner() {
    if (scannerRef.current) return
    setFeedback(null)
    const scanner = new Html5Qrcode(SCANNER_ID)
    scannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async decodedText => {
          const token = tokenFromValue(decodedText)
          if (!token) return
          const now = Date.now()
          if (
            lastScanRef.current &&
            lastScanRef.current.token === token &&
            now - lastScanRef.current.at < 3000
          ) {
            return
          }
          lastScanRef.current = { token, at: now }
          await performCheckIn(token)
        },
        () => {
          /* swallow per-frame decode errors */
        },
      )
      setScanning(true)
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not start camera. Check permissions.',
        'error',
      )
      scannerRef.current = null
    }
  }

  async function stopScanner() {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      await scanner.stop()
      await scanner.clear()
    } catch {
      /* ignore */
    }
    scannerRef.current = null
    setScanning(false)
  }

  const visible = useMemo(() => visibleAttendees(attendees, search), [attendees, search])

  // Counts over the "going" universe (status yes, incl plus-ones + walk-ins).
  const goingRows = useMemo(() => attendees.filter(a => a.status === 'yes'), [attendees])
  const checkedInCount = useMemo(() => attendees.filter(a => a.checked_in_at).length, [attendees])
  const unpaidCount = useMemo(() => attendees.filter(needsPayment).length, [attendees])

  if (loading) return <PageLoader />
  if (!event) return <p className="text-ink/60">Event not found.</p>

  const amount = event.ticket_price

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-2xl text-forest-dark">{event.title} — Door</h1>
          <p className="text-sm text-ink/60">
            {formatDate(event.date)} at {formatTime(event.start_time)} · {checkedInCount} /{' '}
            {goingRows.length} checked in
            {unpaidCount > 0 && <> · {unpaidCount} unpaid</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openDoorQr}>
            Door QR
          </Button>
          <Button variant="outline" size="sm" onClick={() => setQrFor({})}>
            Venmo QR
          </Button>
          <Link to={`/admin/events/${id}/tickets`}>
            <Button variant="ghost" size="sm">
              Tickets
            </Button>
          </Link>
        </div>
      </div>

      {/* Scanner */}
      <div className="bg-white border border-warm rounded-lg p-4 mb-4">
        <div
          id={SCANNER_ID}
          className="w-full max-w-md mx-auto bg-black/5 rounded-lg overflow-hidden"
          style={{ minHeight: scanning ? 300 : 0 }}
        />
        <div className="flex justify-center gap-2 mt-4 flex-wrap">
          {scanning ? (
            <Button variant="outline" onClick={stopScanner}>
              Stop scanner
            </Button>
          ) : (
            <Button onClick={startScanner}>Start scanner</Button>
          )}
          <Button variant="ghost" onClick={() => setShowManual(v => !v)}>
            Enter code manually
          </Button>
        </div>

        {showManual && (
          <form onSubmit={handleManualToken} className="flex gap-2 mt-3 max-w-md mx-auto">
            <Input
              value={manualToken}
              onChange={e => setManualToken(e.target.value)}
              placeholder="Paste ticket link or code"
            />
            <Button type="submit" variant="outline">
              Check in
            </Button>
          </form>
        )}

        {feedback && (
          <div
            className={`mt-4 px-4 py-3 rounded-lg text-center ${
              feedback.kind === 'success'
                ? 'bg-forest/10 text-forest border border-forest/30'
                : feedback.kind === 'already'
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            <p className="font-serif text-lg">
              {feedback.message}
              {feedback.guestName ? ` — ${feedback.guestName}` : ''}
            </p>
            {feedback.notes && (
              <p className="mt-2 text-sm font-medium bg-amber-100 text-amber-900 rounded px-3 py-2 inline-block">
                📝 {feedback.notes}
              </p>
            )}
            {feedback.unpaid && (
              <p className="text-xs mt-2 text-red-700">⚠ This guest is not marked paid.</p>
            )}
            {feedback.kind === 'already' && feedback.at && (
              <p className="text-xs mt-1 opacity-75">
                originally at {new Date(feedback.at).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Search + add walk-in */}
      <div className="flex gap-2 mb-3">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, or phone"
        />
        <Button variant="outline" onClick={() => setWalkInOpen(true)} className="whitespace-nowrap">
          + Walk-in
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="text-ink/60 text-sm py-6 text-center">
          {search.trim() ? (
            <>
              No one matches "{search}".{' '}
              <button className="text-forest underline" onClick={() => setWalkInOpen(true)}>
                Add them as a walk-in
              </button>
              .
            </>
          ) : (
            'No attendees yet.'
          )}
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map(row => {
            const name = `${row.guest.first_name}${
              row.guest.last_name ? ' ' + row.guest.last_name : ''
            }`
            const hostName = hostNameByRsvpId.get(row.id)
            const isPlusOne = !!row.plus_one_of
            const unpaid = needsPayment(row)
            const isBusy = busyRow === row.id
            return (
              <div
                key={row.id}
                className={`bg-white border rounded-lg p-3 ${
                  row.checked_in_at ? 'border-forest/30 bg-forest/5' : 'border-warm'
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{name}</span>
                      {row.walk_in && <Badge variant="info">walk-in</Badge>}
                      {hostName && <Badge variant="default">+1 of {hostName}</Badge>}
                      {row.status === 'pending_payment' && <Badge variant="warning">registered</Badge>}
                      {row.status === 'waitlisted' && <Badge variant="warning">waitlist</Badge>}
                      {row.status === 'maybe' && <Badge variant="default">maybe</Badge>}
                      {row.status === 'no' && <Badge variant="default">declined</Badge>}
                      {/* Plus-ones are covered by their host — no separate payment. */}
                      {!isPlusOne &&
                        (row.payment_status === 'paid' ? (
                          <Badge variant="success">paid</Badge>
                        ) : row.payment_status === 'pending' ? (
                          <Badge variant="warning">said paid</Badge>
                        ) : (
                          <Badge variant="error">unpaid</Badge>
                        ))}
                    </div>
                    {(row.guest.email || row.guest.phone) && (
                      <p className="text-xs text-ink/50 mt-0.5">
                        {row.guest.email}
                        {row.guest.email && row.guest.phone ? ' · ' : ''}
                        {row.guest.phone ? formatPhone(row.guest.phone) : ''}
                      </p>
                    )}
                    {row.checked_in_at && (
                      <p className="text-xs text-forest mt-0.5">
                        Checked in {new Date(row.checked_in_at).toLocaleTimeString()}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap justify-end">
                    {row.checked_in_at ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleUndo(row.id)}
                        loading={isBusy}
                      >
                        Undo
                      </Button>
                    ) : (
                      <>
                        {unpaid && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setQrFor({ name })}
                            >
                              Pay
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleMarkPaid(row)}
                              loading={isBusy}
                            >
                              Mark paid
                            </Button>
                          </>
                        )}
                        <Button size="sm" onClick={() => handleRowCheckIn(row)} loading={isBusy}>
                          Check in
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Note: prominent if present; always editable. */}
                {editingNote === row.id ? (
                  <div className="mt-2">
                    <Textarea
                      value={noteDraft}
                      onChange={e => setNoteDraft(e.target.value)}
                      rows={2}
                      placeholder="e.g. actually paid for two"
                      autoFocus
                    />
                    <div className="flex gap-2 mt-1">
                      <Button size="sm" onClick={() => saveNote(row)} loading={isBusy}>
                        Save note
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingNote(null)
                          setNoteDraft('')
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : row.notes ? (
                  <button
                    className="mt-2 w-full text-left bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded px-3 py-2"
                    onClick={() => {
                      setEditingNote(row.id)
                      setNoteDraft(row.notes || '')
                    }}
                  >
                    📝 {row.notes}
                    <span className="text-xs text-amber-700/70 ml-2">(edit)</span>
                  </button>
                ) : (
                  <button
                    className="mt-2 text-xs text-ink/40 hover:text-forest"
                    onClick={() => {
                      setEditingNote(row.id)
                      setNoteDraft('')
                    }}
                  >
                    + Add note
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <VenmoQrModal
        open={qrFor !== null}
        onClose={() => setQrFor(null)}
        venmoHandle={settings?.venmo_handle || ''}
        qrImageUrl={settings?.venmo_qr_url}
        amount={amount}
        guestName={qrFor?.name}
      />

      <WalkInModal
        open={walkInOpen}
        onClose={() => setWalkInOpen(false)}
        eventId={id!}
        onAdded={name => {
          setWalkInOpen(false)
          setSearch(name)
          loadData()
        }}
      />

      <Modal open={doorOpen} onClose={() => setDoorOpen(false)} title="Door QR — register & pay">
        <div className="text-sm text-ink/70 space-y-3">
          <p>
            Show this at the door. Anyone who scans can register and pay{' '}
            <strong>even when the event is full</strong> — it bypasses the waitlist. They’ll appear
            here flagged “said paid” for you to reconcile against Venmo.
          </p>
          {doorBusy && !doorQr ? (
            <p className="text-ink/50">Generating…</p>
          ) : doorQr ? (
            <>
              <div className="flex justify-center">
                <img
                  src={doorQr.image}
                  alt="Door QR code"
                  width={240}
                  height={240}
                  className="border-2 border-warm rounded"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              <p className="break-all text-xs text-ink/40 text-center">{doorQr.url}</p>
              <div className="flex justify-center gap-2">
                <a href={doorQr.url} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="sm">Open link</Button>
                </a>
                <Button variant="outline" size="sm" onClick={rotateDoorToken} loading={doorBusy}>
                  Rotate code
                </Button>
              </div>
              <p className="text-xs text-ink/50">
                Rotate if the code leaks — the old QR stops working at once.
              </p>
            </>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}

// ---- Walk-in modal --------------------------------------------------------
function WalkInModal({
  open,
  onClose,
  eventId,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  eventId: string
  onAdded: (firstName: string) => void
}) {
  const { addToast } = useToast()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [paid, setPaid] = useState(true)
  const [saving, setSaving] = useState(false)

  function reset() {
    setFirstName('')
    setLastName('')
    setEmail('')
    setPhone('')
    setNotes('')
    setPaid(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!firstName.trim()) {
      addToast('A first name is required', 'error')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.rpc('create_walk_in', {
        p_event_id: eventId,
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim() || null,
        p_email: email.trim() || null,
        p_phone: phone.trim() || null,
        p_notes: notes.trim() || null,
        p_mark_paid: paid,
      })
      if (error) throw error
      addToast(`${firstName.trim()} added to the list`)
      const fn = firstName.trim()
      reset()
      onAdded(fn)
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to add walk-in', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a walk-in">
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm text-ink/60">
          Adds someone who isn't on the list. Only a first name is required.
        </p>
        <div className="flex gap-2">
          <Input
            label="First name"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            required
            autoFocus
          />
          <Input label="Last name" value={lastName} onChange={e => setLastName(e.target.value)} />
        </div>
        <Input
          label="Email (optional)"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <Input
          label="Phone (optional)"
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
        />
        <Textarea
          label="Note (optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. paid cash, friend of the host"
        />
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={paid}
            onChange={e => setPaid(e.target.checked)}
            className="h-4 w-4"
          />
          Already paid
        </label>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Add to list
          </Button>
        </div>
      </form>
    </Modal>
  )
}
