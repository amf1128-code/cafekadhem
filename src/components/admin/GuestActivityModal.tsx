import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../ui/Modal'

interface Props {
  eventId: string
  guestId: string
  guestName: string
  onClose: () => void
}

interface TimelineItem {
  ts: string
  label: string
  sub?: string
}

const STATUS_LABEL: Record<string, string> = {
  yes: 'going',
  pending_payment: 'registered (unpaid)',
  waitlisted: 'waitlist',
  maybe: 'maybe',
  no: "can't go",
}

const PAYMENT_LABEL: Record<string, string> = {
  unpaid: 'unpaid',
  pending: 'said paid',
  paid: 'paid',
  refunded: 'refunded',
}

const PING_LABEL: Record<string, string> = {
  payment_reminder: 'Payment reminder sent',
  payment_unconfirmed: 'Payment check sent',
  waitlist_promoted: 'Waitlist promotion sent',
  maybe_nudge: 'Nudge sent',
  rsvp_confirmation: 'RSVP confirmation sent',
  ticket_issued: 'Ticket sent',
  order_confirmation: 'Order confirmation sent',
  notification_blast: 'Blast sent',
}

// Map a "a → b" transition detail through a label table for readability.
function mapTransition(detail: string | null, table: Record<string, string>): string {
  if (!detail) return ''
  return detail
    .split('→')
    .map(s => table[s.trim()] ?? s.trim())
    .join(' → ')
}

export function GuestActivityModal({ eventId, guestId, guestName, onClose }: Props) {
  const [items, setItems] = useState<TimelineItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [activityRes, pingRes] = await Promise.all([
        supabase
          .from('rsvp_activity')
          .select('kind, detail, created_at')
          .eq('event_id', eventId)
          .eq('guest_id', guestId)
          .order('created_at', { ascending: false }),
        supabase
          .from('notifications_log')
          .select('type, channel, sent_at')
          .eq('event_id', eventId)
          .eq('guest_id', guestId)
          .eq('status', 'sent')
          .order('sent_at', { ascending: false }),
      ])
      if (cancelled) return

      const merged: TimelineItem[] = []

      for (const a of (activityRes.data ?? []) as Array<{ kind: string; detail: string | null; created_at: string }>) {
        let label: string
        switch (a.kind) {
          case 'created':
            label = `Registered${a.detail ? ` — ${STATUS_LABEL[a.detail] ?? a.detail}` : ''}`
            break
          case 'status':
            label = `RSVP: ${mapTransition(a.detail, STATUS_LABEL)}`
            break
          case 'payment':
            label = `Payment: ${mapTransition(a.detail, PAYMENT_LABEL)}`
            break
          case 'walk_in':
            label = 'Added at the door (walk-in)'
            break
          case 'checked_in':
            label = 'Checked in'
            break
          default:
            label = a.kind
        }
        merged.push({ ts: a.created_at, label })
      }

      for (const p of (pingRes.data ?? []) as Array<{ type: string; channel: string | null; sent_at: string | null }>) {
        if (!p.sent_at) continue
        merged.push({
          ts: p.sent_at,
          label: PING_LABEL[p.type] ?? `${p.type} sent`,
          sub: p.channel ? `via ${p.channel}` : undefined,
        })
      }

      merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      if (!cancelled) setItems(merged)
    })()
    return () => {
      cancelled = true
    }
  }, [eventId, guestId])

  return (
    <Modal open onClose={onClose} title={`${guestName} — history`}>
      {items === null ? (
        <p className="text-ink/50 text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-ink/50 text-sm">No activity recorded yet.</p>
      ) : (
        <ol className="relative border-l-2 border-warm ml-2">
          {items.map((it, i) => (
            <li key={i} className="ml-4 pb-4 last:pb-0">
              <span className="absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full bg-forest border-2 border-cream" />
              <div className="text-sm text-ink">{it.label}</div>
              {it.sub && <div className="text-xs text-ink/50">{it.sub}</div>}
              <div className="text-xs text-ink/40">{formatStamp(it.ts)}</div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  )
}

function formatStamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
