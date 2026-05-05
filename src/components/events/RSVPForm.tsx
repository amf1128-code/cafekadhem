import { useState, useEffect, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { RSVP, Event, AdminSettings } from '../../lib/types'
import { getGuestToken, setGuestToken } from '../../lib/utils/guest-token'
import { normalizePhone, isValidPhone } from '../../lib/utils/phone'
import { normalizeInstagram, isValidInstagram } from '../../lib/utils/instagram'
import { sendNotification } from '../../lib/notifications'
import { useToast } from '../ui/Toast'

interface RSVPFormProps {
  eventId: string
  event?: Event | null
  existingRsvp: RSVP | null
  isFull: boolean
  onRsvpComplete: () => void
}

function UnderlineInput({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex items-baseline gap-4">
      <label className="text-[10px] tracking-[0.2em] uppercase text-ink-muted whitespace-nowrap min-w-[80px]">
        {label}
      </label>
      <input
        className="flex-1 border-0 border-b border-warm bg-transparent py-2 font-script text-lg text-ink italic placeholder:text-stone-dark placeholder:italic outline-none focus:border-ink transition-colors"
        {...props}
      />
    </div>
  )
}

export function RSVPForm({ eventId, event, existingRsvp, isFull, onRsvpComplete }: RSVPFormProps) {
  const { addToast } = useToast()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [instagram, setInstagram] = useState('')
  const [notifPref, setNotifPref] = useState('email')
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(!existingRsvp)
  const [venmoHandle, setVenmoHandle] = useState<string>('')
  const [markingPaid, setMarkingPaid] = useState(false)

  useEffect(() => {
    supabase
      .from('admin_settings')
      .select('venmo_handle')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setVenmoHandle((data as Pick<AdminSettings, 'venmo_handle'>).venmo_handle)
      })
  }, [])

  async function handleMarkPaymentPending() {
    if (!existingRsvp) return
    setMarkingPaid(true)
    try {
      const { error } = await supabase.rpc('mark_payment_pending', {
        p_rsvp_id: existingRsvp.id,
      })
      if (error) throw error
      addToast("Thanks — your host will confirm shortly.")
      onRsvpComplete()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to mark paid', 'error')
    } finally {
      setMarkingPaid(false)
    }
  }

  useEffect(() => {
    const guestToken = getGuestToken()
    if (guestToken) {
      supabase
        .rpc('get_my_guest', { p_guest_id: guestToken })
        .then(({ data }) => {
          if (data) {
            setFirstName(data.first_name)
            setLastName(data.last_name || '')
            setEmail(data.email || '')
            setPhone(data.phone || '')
            setInstagram(data.instagram || '')
            setNotifPref(data.notification_preference)
          }
        })
    }
  }, [])

  async function handleRSVP(status: 'yes' | 'maybe' | 'no') {
    if (!firstName.trim()) {
      addToast('Please enter your first name.', 'error')
      return
    }
    if (!email.trim() && !phone.trim()) {
      addToast('Please provide an email or phone number.', 'error')
      return
    }
    if (notifPref === 'email' && !email.trim()) {
      addToast('Please provide an email address to be notified by email.', 'error')
      return
    }
    if (notifPref === 'sms' && !phone.trim()) {
      addToast('Please provide a phone number to be notified by SMS.', 'error')
      return
    }
    if (phone.trim() && !isValidPhone(phone.trim())) {
      addToast('Please enter a valid US phone number.', 'error')
      return
    }
    if (instagram && !isValidInstagram(instagram)) {
      addToast('Invalid Instagram handle format.', 'error')
      return
    }

    setLoading(true)

    try {
      // Single round-trip upsert: dedups by email/phone server-side or
      // updates by id when we already have a localStorage token. The
      // form covers all six guest fields, so we send all six.
      const { data: guest, error: guestErr } = await supabase.rpc('upsert_guest', {
        p_fields: {
          first_name: firstName.trim(),
          last_name: lastName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() ? normalizePhone(phone.trim()) : null,
          instagram: instagram.trim() ? normalizeInstagram(instagram.trim()) : null,
          notification_preference: notifPref,
        },
        p_guest_id: getGuestToken(),
      })
      if (guestErr) throw guestErr
      if (!guest) throw new Error('Failed to create guest record')
      const guestId = guest.id
      setGuestToken(guestId)

      // Use safe_create_rsvp function for capacity enforcement
      const { data: rsvpResult, error: rsvpError } = await supabase.rpc('safe_create_rsvp', {
        p_event_id: eventId,
        p_guest_id: guestId,
        p_status: status,
      })

      if (rsvpError) throw rsvpError

      // Send notification
      if (status !== 'no') {
        const finalStatus = rsvpResult?.status || status
        sendNotification({
          guestId,
          eventId,
          type: 'rsvp_confirmation',
          data: {
            status: finalStatus,
            is_ticketed: event?.ticketing_enabled ? 'true' : 'false',
          },
        })
      }

      const returnedStatus = rsvpResult?.status
      if (returnedStatus === 'waitlisted') {
        const pos = rsvpResult?.waitlist_position
        addToast(`You're on the waitlist${pos ? ` (position #${pos})` : ''}!`)
      } else {
        addToast(
          status === 'yes'
            ? "You're going!"
            : status === 'maybe'
            ? 'Marked as maybe.'
            : 'RSVP updated.'
        )
      }

      setShowForm(false)
      onRsvpComplete()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to RSVP', 'error')
    } finally {
      setLoading(false)
    }
  }

  if (existingRsvp && !showForm) {
    const statusLabels: Record<string, string> = { yes: 'Going', maybe: 'Maybe', no: 'Not going', waitlisted: 'Waitlisted' }
    const isWaitlisted = existingRsvp.status === 'waitlisted'
    const ticketed = !!event?.ticketing_enabled
    const showPaymentFlow =
      ticketed &&
      existingRsvp.status === 'yes' &&
      existingRsvp.payment_status !== 'paid'
    const showTicketLink =
      ticketed &&
      existingRsvp.status === 'yes' &&
      existingRsvp.payment_status === 'paid' &&
      !!existingRsvp.ticket_token

    const amount = (event?.ticket_price ?? 0).toFixed(2)
    const note = encodeURIComponent(`${firstName || 'Ticket'} - ${event?.title || 'Cafe Kadhem'}`)
    const venmoMobileUrl = venmoHandle
      ? `venmo://paycharge?txn=pay&recipients=${venmoHandle}&amount=${amount}&note=${note}`
      : ''
    const venmoWebUrl = venmoHandle
      ? `https://venmo.com/${venmoHandle}?txn=pay&amount=${amount}&note=${note}`
      : ''
    const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

    return (
      <div className="text-center py-4">
        <p className="font-serif text-xl text-ink italic mb-1">
          Your RSVP: <span className={isWaitlisted ? 'text-accent' : 'text-forest'}>
            {statusLabels[existingRsvp.status] || existingRsvp.status}
          </span>
        </p>
        {isWaitlisted && existingRsvp.waitlist_position && (
          <p className="text-sm text-ink-muted mb-3">Position #{existingRsvp.waitlist_position} on the waitlist</p>
        )}

        {showPaymentFlow && (
          <div className="mt-6 mb-4 border border-warm rounded-lg p-5 text-left bg-cream/40">
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-2">Ticket Payment</p>
            {existingRsvp.payment_status === 'pending' ? (
              <>
                <p className="font-serif text-lg text-ink italic mb-2">
                  Payment received — awaiting confirmation.
                </p>
                <p className="text-sm text-ink-muted">
                  Your host will verify the Venmo and send your QR-code ticket. If you haven't actually sent it yet, you can resend below.
                </p>
              </>
            ) : (
              <>
                <p className="font-serif text-lg text-ink italic mb-3">
                  Send <span className="font-medium not-italic">${amount}</span> via Venmo to confirm your seat.
                </p>
                <p className="text-sm text-ink-muted mb-3">
                  Note must include your name and the event title so your host can match the payment.
                </p>
              </>
            )}
            {venmoHandle && (
              <a
                href={isMobile ? venmoMobileUrl : venmoWebUrl}
                target={isMobile ? undefined : '_blank'}
                rel="noopener noreferrer"
                className="inline-block bg-forest text-cream px-6 py-3 text-xs tracking-[0.2em] uppercase hover:bg-forest-light transition-colors"
              >
                Pay ${amount} on Venmo
              </a>
            )}
            <div className="mt-4">
              <button
                onClick={handleMarkPaymentPending}
                disabled={markingPaid || existingRsvp.payment_status === 'pending'}
                className="border border-warm px-5 py-2 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors disabled:opacity-50"
              >
                {existingRsvp.payment_status === 'pending'
                  ? "[ Marked as Paid ]"
                  : markingPaid
                  ? '[ Recording... ]'
                  : "[ I've Paid ]"}
              </button>
            </div>
          </div>
        )}

        {showTicketLink && (
          <div className="mt-6 mb-4">
            <a
              href={`/ticket/${existingRsvp.ticket_token}`}
              className="inline-block bg-forest text-cream px-8 py-3 text-xs tracking-[0.2em] uppercase hover:bg-forest-light transition-colors"
            >
              View Your Ticket
            </a>
            <p className="text-xs text-ink-muted mt-2 italic">
              Also sent via {existingRsvp.checked_in_at ? 'your preferred channel' : 'email or SMS'}.
            </p>
          </div>
        )}

        <button
          onClick={() => setShowForm(true)}
          className="border border-warm px-6 py-2 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors"
        >
          [ Change RSVP ]
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={(e: FormEvent) => e.preventDefault()} className="space-y-6">
      <UnderlineInput
        label="Name"
        value={firstName}
        onChange={e => setFirstName(e.target.value)}
        placeholder="Enter your first name"
        required
      />
      <UnderlineInput
        label="Last Name"
        value={lastName}
        onChange={e => setLastName(e.target.value)}
        placeholder="Optional"
      />
      <UnderlineInput
        label="Email"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="email@address.com"
      />
      <UnderlineInput
        label="Phone"
        type="tel"
        value={phone}
        onChange={e => setPhone(e.target.value)}
        placeholder="Required if no email"
      />
      <UnderlineInput
        label="Instagram"
        value={instagram}
        onChange={e => setInstagram(e.target.value)}
        placeholder="Optional (without @)"
      />

      {/* Notification preference */}
      <div className="flex items-baseline gap-4">
        <label className="text-[10px] tracking-[0.2em] uppercase text-ink-muted whitespace-nowrap min-w-[80px]">
          Notify via
        </label>
        <select
          value={notifPref}
          onChange={e => setNotifPref(e.target.value)}
          className="flex-1 border-0 border-b border-warm bg-transparent py-2 font-script text-lg text-ink italic outline-none focus:border-ink transition-colors appearance-none cursor-pointer"
        >
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="none">None</option>
        </select>
      </div>

      {/* RSVP buttons — bracket style */}
      <div className="flex justify-center pt-4">
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => handleRSVP('yes')}
            disabled={loading}
            className="border border-forest px-8 py-3 text-xs tracking-[0.2em] uppercase text-forest hover:bg-forest hover:text-cream transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            [ {isFull ? 'Join Waitlist' : 'Reserve a Seat'} ]
          </button>
          <button
            type="button"
            onClick={() => handleRSVP('maybe')}
            disabled={loading}
            className="border border-warm px-6 py-3 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            [ Maybe ]
          </button>
          <button
            type="button"
            onClick={() => handleRSVP('no')}
            disabled={loading}
            className="px-4 py-3 text-xs tracking-[0.2em] uppercase text-stone-dark hover:text-ink transition-colors disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      </div>
    </form>
  )
}
