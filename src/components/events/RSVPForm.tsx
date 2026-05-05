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
  // Default to "SMS off" so the phone input never flashes visible while
  // the admin_settings fetch is in flight. Flips on only if the saved
  // setting says so.
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  // Plus-one state. Available on first-time RSVPs to non-ticketed events
  // (ticketed events would require collecting a second payment, which
  // is out of scope for the +1 flow).
  const [plusOne, setPlusOne] = useState(false)
  const [plusOneName, setPlusOneName] = useState('')
  const showPlusOneToggle = !existingRsvp && !event?.ticketing_enabled

  useEffect(() => {
    supabase
      .from('admin_settings')
      .select('venmo_handle, sms_enabled')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          const row = data as Pick<AdminSettings, 'venmo_handle' | 'sms_enabled'>
          setVenmoHandle(row.venmo_handle)
          setSmsEnabled(!!row.sms_enabled)
        }
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

  // Force any stale 'sms' preference to 'email' as soon as we know SMS
  // is disabled (covers both fresh loads with smsEnabled=false and the
  // case where the admin flips SMS off mid-session).
  useEffect(() => {
    if (!smsEnabled && notifPref === 'sms') setNotifPref('email')
  }, [smsEnabled, notifPref])

  async function handleRSVP(status: 'yes' | 'maybe' | 'no') {
    if (!firstName.trim()) {
      addToast('Please enter your first name.', 'error')
      return
    }
    if (smsEnabled) {
      if (!email.trim() && !phone.trim()) {
        addToast('Please provide an email or phone number.', 'error')
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
    } else {
      // Phone input is hidden while SMS is disabled; require email.
      if (!email.trim()) {
        addToast('Please provide an email address.', 'error')
        return
      }
    }
    if (notifPref === 'email' && !email.trim()) {
      addToast('Please provide an email address to be notified by email.', 'error')
      return
    }
    if (instagram && !isValidInstagram(instagram)) {
      addToast('Invalid Instagram handle format.', 'error')
      return
    }
    // Plus-one is only attempted alongside an actual reservation, and
    // only when the toggle is on. If the user toggled it but left the
    // name blank, ask before submitting (rather than silently dropping
    // their +1 intent).
    const wantPlusOne = showPlusOneToggle && plusOne && status === 'yes'
    if (wantPlusOne && !plusOneName.trim()) {
      addToast("Please enter your plus-one's first name, or turn the +1 off.", 'error')
      return
    }

    setLoading(true)

    try {
      // Single round-trip upsert: dedups by email/phone server-side or
      // updates by id when we already have a localStorage token.
      // While SMS is disabled the phone input is hidden — we deliberately
      // OMIT the `phone` key from p_fields rather than sending null, so
      // a returning guest's stored number is preserved untouched (it
      // becomes editable again whenever the admin flips SMS back on).
      const fields: Record<string, unknown> = {
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        email: email.trim() || null,
        instagram: instagram.trim() ? normalizeInstagram(instagram.trim()) : null,
        notification_preference: notifPref,
      }
      if (smsEnabled) {
        fields.phone = phone.trim() ? normalizePhone(phone.trim()) : null
      }
      const { data: guest, error: guestErr } = await supabase.rpc('upsert_guest', {
        p_fields: fields,
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

      // Plus-one: chained after the host's RSVP so we have its id to link
      // against. If the +1 ends up waitlisted (capacity exhausted by the
      // host's seat) we just surface that in the toast — the row is still
      // created, admin can promote later.
      let plusOneRsvp: { status?: string; waitlist_position?: number } | null = null
      if (wantPlusOne && rsvpResult?.id) {
        const { data: poData, error: poError } = await supabase.rpc('add_plus_one', {
          p_parent_rsvp_id: rsvpResult.id,
          p_first_name: plusOneName.trim(),
        })
        if (poError) {
          // Host RSVP succeeded; surface the +1 failure but don't unwind.
          addToast(`RSVP saved, but couldn't add your +1: ${poError.message}`, 'error')
        } else {
          plusOneRsvp = poData
        }
      }

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
      const plusOneSuffix = plusOneRsvp
        ? plusOneRsvp.status === 'waitlisted'
          ? ` Your +1 ${plusOneName.trim()} is on the waitlist — capacity was hit on this seat.`
          : ` ${plusOneName.trim()} is in too.`
        : ''
      if (returnedStatus === 'waitlisted') {
        const pos = rsvpResult?.waitlist_position
        addToast(`You're on the waitlist${pos ? ` (position #${pos})` : ''}!${plusOneSuffix}`)
      } else {
        addToast(
          (status === 'yes'
            ? "You're going!"
            : status === 'maybe'
            ? 'Marked as maybe.'
            : 'RSVP updated.') + plusOneSuffix
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
      {smsEnabled && (
        <UnderlineInput
          label="Phone"
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="Required if no email"
        />
      )}
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
          {smsEnabled && <option value="sms">SMS</option>}
          <option value="none">None</option>
        </select>
      </div>

      {/* Plus-one toggle. Only shown for first-time RSVPs to non-ticketed
          events; the +1 is created when the user clicks Reserve a Seat. */}
      {showPlusOneToggle && (
        <div className="space-y-3 pt-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={plusOne}
              onChange={e => setPlusOne(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-[10px] tracking-[0.2em] uppercase text-ink-muted">
              Bringing a +1?
            </span>
          </label>
          {plusOne && (
            <UnderlineInput
              label="+1 Name"
              value={plusOneName}
              onChange={e => setPlusOneName(e.target.value)}
              placeholder="Their first name"
            />
          )}
        </div>
      )}

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
