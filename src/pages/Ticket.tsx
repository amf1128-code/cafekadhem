import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { TicketView } from '../lib/types'
import { formatDate, formatTime } from '../lib/utils/date'
import { ticketUrl } from '../lib/utils/ticket'
import { PageLoader } from '../components/ui/LoadingSpinner'
import { QRCode } from '../components/tickets/QRCode'

export function Ticket() {
  const { token } = useParams<{ token: string }>()
  const [ticket, setTicket] = useState<TicketView | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!token) {
      setNotFound(true)
      setLoading(false)
      return
    }
    supabase
      .rpc('get_ticket', { p_token: token })
      .then(({ data, error }) => {
        if (error || !data) {
          setNotFound(true)
        } else {
          setTicket(data as TicketView)
        }
        setLoading(false)
      })
  }, [token])

  if (loading) return <PageLoader />

  if (notFound || !ticket) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <p className="font-serif text-xl text-ink-muted italic">
          Ticket not found.
        </p>
        <p className="text-sm text-ink-muted mt-3">
          If you've recently paid, your host may not have confirmed yet — check back shortly.
        </p>
      </div>
    )
  }

  const fullName = `${ticket.guest_first_name}${ticket.guest_last_name ? ' ' + ticket.guest_last_name : ''}`
  const checkedIn = !!ticket.checked_in_at
  const url = ticketUrl(ticket.token)

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="border border-warm bg-parchment-light p-6 md:p-10">
        <p className="text-xs tracking-[0.25em] uppercase text-ink-muted mb-2 text-center">
          Cafe Kadhem
        </p>
        {ticket.gathering_number && (
          <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted text-center mb-4">
            Gathering {ticket.gathering_number}
          </p>
        )}
        <h1 className="font-serif text-2xl md:text-3xl text-forest-dark italic text-center mb-6">
          {ticket.event_title}
        </h1>

        <div className="border-t border-warm mb-6" />

        <div className="grid grid-cols-2 gap-4 mb-6 text-center">
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1">Guest</p>
            <p className="font-serif text-lg text-ink">{fullName}</p>
          </div>
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1">Date</p>
            <p className="font-serif text-lg text-ink">{formatDate(ticket.event_date)}</p>
          </div>
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1">Time</p>
            <p className="font-serif text-lg text-ink">
              {formatTime(ticket.event_start_time)}
              {ticket.event_end_time ? ` – ${formatTime(ticket.event_end_time)}` : ''}
            </p>
          </div>
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1">Location</p>
            <p className="font-serif text-lg text-ink">
              {ticket.event_location_name || ticket.event_location.split(',')[0]}
            </p>
          </div>
        </div>

        <div className="border-t border-warm mb-6" />

        <div className="flex flex-col items-center">
          {checkedIn ? (
            <div className="text-center mb-4">
              <p className="text-xs tracking-[0.2em] uppercase text-forest mb-1">Checked In</p>
              <p className="text-sm text-ink-muted italic">
                Welcome — you scanned in at{' '}
                {new Date(ticket.checked_in_at!).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            </div>
          ) : (
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-4">
              Show this at the door
            </p>
          )}
          <div className={`p-4 bg-cream border border-warm ${checkedIn ? 'opacity-50' : ''}`}>
            <QRCode value={url} size={240} />
          </div>
          <p className="text-[10px] tracking-[0.15em] uppercase text-stone-dark mt-4 break-all text-center">
            {ticket.token}
          </p>
        </div>
      </div>

      <p className="text-center text-xs text-ink-muted mt-6">
        Save this page or screenshot the QR code so it's ready at the door.
      </p>
    </div>
  )
}
