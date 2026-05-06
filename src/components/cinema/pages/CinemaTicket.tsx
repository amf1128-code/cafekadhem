import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { supabase } from '../../../lib/supabase'
import type { TicketView } from '../../../lib/types'
import { CinemaPageLoader } from '../primitives'

/**
 * /ticket/:token — cinema-styled paid ticket display. QR encodes
 * the same /ticket/:token URL so the door scanner reads it.
 */
export function CinemaTicket() {
  const { token } = useParams<{ token: string }>()
  const [ticket, setTicket] = useState<TicketView | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token) {
        setLoading(false)
        return
      }
      const { data, error } = await supabase.rpc('get_ticket', {
        p_token: token,
      })
      if (cancelled) return
      if (error || !data) {
        setNotFound(true)
        setLoading(false)
        return
      }
      const row = Array.isArray(data) ? data[0] : data
      setTicket(row as TicketView)
      const url =
        typeof window !== 'undefined' ? window.location.href : `/ticket/${token}`
      const dataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        width: 480,
        color: { dark: '#0d0d0f', light: '#f4ecd8' },
      })
      if (!cancelled) {
        setQrUrl(dataUrl)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  if (loading) return <CinemaPageLoader />
  if (notFound || !ticket) {
    return (
      <section className="ck-page" style={{ textAlign: 'center', borderBottom: 'none' }}>
        <div className="ck-narrow">
          <div className="ck-eyebrow">✦ Hmm</div>
          <h1 className="ck-h1" style={{ marginTop: 12 }}>
            TICKET NOT
            <br />
            <span className="ck-italic">found</span>
          </h1>
          <p
            className="ck-italic"
            style={{ fontSize: 18, marginTop: 18 }}
          >
            This link is no longer valid. Try the lookup form.
          </p>
        </div>
      </section>
    )
  }

  const day = formatDay(ticket.event_date)
  const date = formatDate(ticket.event_date)
  const start = formatTime(ticket.event_start_time, ticket.event_end_time)
  const loc = [ticket.event_location_name, ticket.event_location]
    .filter(Boolean)
    .join(' · ')
  const checkedIn = !!ticket.checked_in_at
  const fullName = [ticket.guest_first_name, ticket.guest_last_name]
    .filter(Boolean)
    .join(' ')

  return (
    <section className="ck-page" style={{ borderBottom: 'none' }}>
      <div className="ck-narrow">
        <div className="ck-eyebrow">✦ Your ticket</div>
        <h1 className="ck-h1" style={{ marginTop: 12 }}>
          {ticket.event_title.toUpperCase()}
        </h1>
        <p
          className="ck-italic"
          style={{
            fontSize: 18,
            marginTop: 12,
            color: 'var(--ck-cobalt)',
          }}
        >
          {day} {date} · {start}
        </p>

        {/* Ticket card */}
        <div
          className="ck-card"
          style={{
            marginTop: 28,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: '1fr',
          }}
        >
          {qrUrl && (
            <div
              style={{
                background: 'var(--ck-cream)',
                padding: 32,
                textAlign: 'center',
                borderBottom: '2px dashed var(--ck-ink)',
              }}
            >
              <img
                src={qrUrl}
                alt="Ticket QR code"
                width={280}
                height={280}
                style={{
                  display: 'inline-block',
                  imageRendering: 'pixelated',
                  border: '2px solid var(--ck-ink)',
                  background: 'var(--ck-cream)',
                }}
              />
              <div
                style={{
                  marginTop: 14,
                  fontFamily: 'var(--ck-mono)',
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  opacity: 0.7,
                }}
              >
                Show this at the door
              </div>
            </div>
          )}

          <div style={{ padding: 24 }}>
            <Row label="Name" value={fullName} />
            <Row label="When" value={`${day} ${date} · ${start}`} />
            <Row label="Where" value={loc || 'TBA'} />
            {ticket.gathering_number && (
              <Row
                label="Pop-up"
                value={`No. ${ticket.gathering_number.replace(/^\s*(no\.?|number|num\.?|#)\s*/i, '')}`}
              />
            )}
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px dashed var(--ck-ink)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontFamily: 'var(--ck-mono)',
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
              }}
            >
              <span>Status</span>
              <span
                style={{
                  padding: '4px 10px',
                  background: checkedIn ? 'var(--ck-ink)' : 'var(--ck-cobalt)',
                  color: 'var(--ck-cream)',
                }}
              >
                {checkedIn ? 'Checked in ✓' : 'Ready'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr',
        gap: 12,
        padding: '8px 0',
        borderBottom: '1px solid rgba(13,13,15,0.1)',
        alignItems: 'baseline',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--ck-mono)',
          fontSize: 9,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          opacity: 0.65,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--ck-serif)',
          fontWeight: 700,
          fontSize: 17,
          lineHeight: 1.3,
        }}
      >
        {value}
      </span>
    </div>
  )
}

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return m && d ? `${m}.${d}` : dateStr
}
function formatDay(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return date
    .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })
    .toUpperCase()
}
function formatTime(start: string, end: string | null): string {
  const startHour = Number(start.split(':')[0])
  const period = startHour >= 12 ? 'PM' : 'AM'
  const display = startHour % 12 || 12
  if (!end) return `${display}${period} TILL LATE`
  const endHour = Number(end.split(':')[0])
  const endPeriod = endHour >= 12 ? 'PM' : 'AM'
  const endDisplay = endHour % 12 || 12
  return `${display}${period} – ${endDisplay}${endPeriod}`
}
