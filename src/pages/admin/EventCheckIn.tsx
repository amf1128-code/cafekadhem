import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../../lib/supabase'
import type { Event, RSVP, Guest, CheckInResult } from '../../lib/types'
import { formatDate, formatTime } from '../../lib/utils/date'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'

type AttendeeRow = RSVP & { guest: Guest }

interface ScanFeedback {
  kind: 'success' | 'already' | 'error'
  message: string
  guestName?: string
  at?: number
}

const SCANNER_ID = 'kadhem-qr-scanner'

function tokenFromValue(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Accept either a URL like https://.../ticket/<token> or the bare token
  try {
    const u = new URL(trimmed)
    const parts = u.pathname.split('/').filter(Boolean)
    const i = parts.indexOf('ticket')
    if (i >= 0 && parts[i + 1]) return parts[i + 1]
  } catch {
    /* not a URL */
  }
  if (/^[a-f0-9]{16,64}$/i.test(trimmed)) return trimmed
  return null
}

export function AdminEventCheckIn() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [event, setEvent] = useState<Event | null>(null)
  const [attendees, setAttendees] = useState<AttendeeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [scanning, setScanning] = useState(false)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastScanRef = useRef<{ token: string; at: number } | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    if (id) loadData()
    return () => {
      stopScanner()
    }
  }, [id])

  async function loadData() {
    const [eventResult, rsvpResult] = await Promise.all([
      supabase.from('events').select('*').eq('id', id!).single(),
      supabase
        .from('rsvps')
        .select('*, guest:guests!guest_id(*)')
        .eq('event_id', id!)
        .eq('status', 'yes')
        .eq('payment_status', 'paid')
        .order('checked_in_at', { ascending: false, nullsFirst: false }),
    ])
    if (eventResult.data) setEvent(eventResult.data)
    if (rsvpResult.data) setAttendees(rsvpResult.data as AttendeeRow[])
    setLoading(false)
  }

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
      const name = `${result.guest_first_name || ''}${result.guest_last_name ? ' ' + result.guest_last_name : ''}`.trim()
      if (result.already_checked_in) {
        setFeedback({
          kind: 'already',
          message: `Already checked in`,
          guestName: name,
          at: result.checked_in_at ? new Date(result.checked_in_at).getTime() : undefined,
        })
      } else {
        setFeedback({ kind: 'success', message: 'Welcome', guestName: name })
      }
      // Update local list quickly
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

  async function startScanner() {
    if (scannerRef.current) return
    setFeedback(null)
    const scanner = new Html5Qrcode(SCANNER_ID)
    scannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decodedText) => {
          const token = tokenFromValue(decodedText)
          if (!token) return
          // Debounce duplicate scans of same token within 3s
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
        }
      )
      setScanning(true)
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not start camera. Check permissions.',
        'error'
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

  async function handleManualCheckIn(row: AttendeeRow) {
    if (!row.ticket_token) {
      addToast('No ticket issued for this RSVP', 'error')
      return
    }
    await performCheckIn(row.ticket_token)
  }

  async function handleUndo(rsvpId: string) {
    if (!confirm('Undo this check-in?')) return
    const { error } = await supabase.rpc('undo_check_in', { p_rsvp_id: rsvpId })
    if (error) {
      addToast(error.message, 'error')
      return
    }
    addToast('Check-in reverted')
    await loadData()
  }

  const filtered = attendees.filter(a => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const name = `${a.guest.first_name} ${a.guest.last_name || ''}`.toLowerCase()
    return name.includes(q) || (a.guest.email || '').toLowerCase().includes(q)
  })

  const checkedInCount = attendees.filter(a => !!a.checked_in_at).length

  if (loading) return <PageLoader />
  if (!event) return <p className="text-ink/60">Event not found.</p>

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-2xl text-forest-dark">{event.title} - Door</h1>
          <p className="text-sm text-ink/60">
            {formatDate(event.date)} at {formatTime(event.start_time)} ·{' '}
            {checkedInCount} / {attendees.length} checked in
          </p>
        </div>
        <Link to={`/admin/events/${id}/tickets`}>
          <Button variant="ghost" size="sm">Tickets</Button>
        </Link>
      </div>

      {/* Scanner */}
      <div className="bg-white border border-warm rounded-lg p-4 mb-6">
        <div
          id={SCANNER_ID}
          className="w-full max-w-md mx-auto bg-black/5 rounded-lg overflow-hidden"
          style={{ minHeight: scanning ? 300 : 0 }}
        />
        <div className="flex justify-center mt-4">
          {scanning ? (
            <Button variant="outline" onClick={stopScanner}>
              Stop scanner
            </Button>
          ) : (
            <Button onClick={startScanner}>
              Start scanner
            </Button>
          )}
        </div>

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
            {feedback.kind === 'already' && feedback.at && (
              <p className="text-xs mt-1 opacity-75">
                originally at {new Date(feedback.at).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Manual search fallback */}
      <div className="mb-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email"
          className="w-full px-3 py-2 border border-warm rounded-lg bg-white"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-ink/60 text-sm">No matching guests.</p>
      ) : (
        <div className="bg-white border border-warm rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm bg-warm/30">
                <th className="text-left px-4 py-2 font-medium text-ink/70">Guest</th>
                <th className="text-left px-4 py-2 font-medium text-ink/70">Status</th>
                <th className="text-right px-4 py-2 font-medium text-ink/70">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className="border-b border-warm/50 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium">{row.guest.first_name}</span>
                    {row.guest.last_name && (
                      <span className="text-ink/70"> {row.guest.last_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.checked_in_at ? (
                      <div>
                        <Badge variant="success">Checked in</Badge>
                        <p className="text-xs text-ink/50 mt-1">
                          {new Date(row.checked_in_at).toLocaleTimeString()}
                        </p>
                      </div>
                    ) : (
                      <Badge variant="default">Not yet</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.checked_in_at ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleUndo(row.id)}
                      >
                        Undo
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => handleManualCheckIn(row)}>
                        Check in
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
