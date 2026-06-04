import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { RSVP, Event, AdminSettings } from '../../lib/types'
import { getGuestToken, setGuestToken } from '../../lib/utils/guest-token'
import { buildVenmoNote } from '../../lib/payment/venmo'
import { normalizePhone, isValidPhone } from '../../lib/utils/phone'
import { ConsentNote } from '../ui/ConsentNote'
import { useToast } from '../ui/Toast'

// New payment-gated RSVP flow (events.use_new_rsvp_flow). "Going" routes
// through payment — the guest is recorded as 'pending_payment' (saved but
// NOT counted) until they pay or self-attest, then flips to 'yes'.
// "Maybe" / "Can't go" just capture the guest + their response (for future
// events); they're never counted and never pay.
//
// Steps:
//   form     -> info + Going / Maybe / Can't go
//   pay      -> price + Venmo deeplink + "I've already paid"   (Going)
//   confirm  -> "Did you send $X?" yes -> going / no -> saved
//   going    -> counted; ticket once paid
//   saved    -> registered but said not-paid-yet (not counted)
//   maybe    -> marked maybe
//   declined -> marked can't go

type Step = 'form' | 'pay' | 'confirm' | 'going' | 'saved' | 'maybe' | 'declined'

interface Props {
  eventId: string
  event: Event
  settings: AdminSettings | null
  existingRsvp: RSVP | null
  onComplete: () => void
}

function stepForStatus(status: RSVP['status'] | undefined): Step {
  switch (status) {
    case 'yes':
      return 'going'
    case 'pending_payment':
      return 'pay'
    case 'maybe':
      return 'maybe'
    case 'no':
      return 'declined'
    default:
      return 'form'
  }
}

function Field({
  label,
  optional,
  ...props
}: { label: string; optional?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label className="ck-label">
        {label}
        {optional && <span style={{ opacity: 0.5, marginLeft: 6 }}>· optional</span>}
      </label>
      <input className="ck-input" {...props} />
    </div>
  )
}

export function NewTicketedRsvp({ eventId, event, settings, existingRsvp, onComplete }: Props) {
  const { addToast } = useToast()
  const [rsvp, setRsvp] = useState<RSVP | null>(existingRsvp)
  const [step, setStep] = useState<Step>(stepForStatus(existingRsvp?.status))
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [paidBusy, setPaidBusy] = useState(false)

  const smsEnabled = !!settings?.sms_enabled
  const venmoHandle = settings?.venmo_handle || ''
  const amount = (event.ticket_price ?? 0).toFixed(2)
  const isMobile =
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  // Prefill from a known guest so a returning visitor doesn't retype.
  useEffect(() => {
    const token = getGuestToken()
    if (!token) return
    supabase.rpc('get_my_guest', { p_guest_id: token }).then(({ data }) => {
      if (data) {
        setFirstName(data.first_name || '')
        setLastName(data.last_name || '')
        setEmail(data.email || '')
        setPhone(data.phone || '')
      }
    })
  }, [])

  const note = encodeURIComponent(
    buildVenmoNote({ firstName: firstName || 'Ticket', eventTitle: event.title }),
  )
  const venmoUrl = venmoHandle
    ? isMobile
      ? `venmo://paycharge?txn=pay&recipients=${venmoHandle}&amount=${amount}&note=${note}`
      : `https://venmo.com/${venmoHandle}?txn=pay&amount=${amount}&note=${note}`
    : ''

  // Validate + upsert the guest record. Returns the guest id, or null
  // (after toasting) if validation failed. Shared by all three responses.
  async function upsertGuest(): Promise<string | null> {
    if (!firstName.trim()) {
      addToast('Please enter your first name.', 'error')
      return null
    }
    if (!email.trim() && !(smsEnabled && phone.trim())) {
      addToast(
        smsEnabled ? 'Please provide an email or phone number.' : 'Please provide an email address.',
        'error',
      )
      return null
    }
    if (smsEnabled && phone.trim() && !isValidPhone(phone.trim())) {
      addToast('Please enter a valid US phone number.', 'error')
      return null
    }

    const fields: Record<string, unknown> = {
      first_name: firstName.trim(),
      last_name: lastName.trim() || null,
      email: email.trim() || null,
    }
    if (smsEnabled) fields.phone = phone.trim() ? normalizePhone(phone.trim()) : null

    const { data: guest, error } = await supabase.rpc('upsert_guest', {
      p_fields: fields,
      p_guest_id: existingRsvp?.guest_id ?? getGuestToken(),
    })
    if (error) throw error
    if (!guest) throw new Error('Could not save your info')
    const guestId = guest.id as string
    setGuestToken(guestId)
    return guestId
  }

  async function handleGoing() {
    setLoading(true)
    try {
      const guestId = await upsertGuest()
      if (!guestId) return
      const { data: created, error } = await supabase.rpc('register_pending_payment', {
        p_event_id: eventId,
        p_guest_id: guestId,
      })
      if (error) throw error
      setRsvp(created as RSVP)
      setStep('pay')
      onComplete()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Something went wrong', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Maybe / Can't go: capture the guest + response. Never paid, never
  // counted. Reuses safe_create_rsvp (capacity logic only applies to 'yes').
  async function handleResponse(status: 'maybe' | 'no') {
    setLoading(true)
    try {
      const guestId = await upsertGuest()
      if (!guestId) return
      const { data: created, error } = await supabase.rpc('safe_create_rsvp', {
        p_event_id: eventId,
        p_guest_id: guestId,
        p_status: status,
      })
      if (error) throw error
      setRsvp((created as RSVP) ?? null)
      setStep(status === 'maybe' ? 'maybe' : 'declined')
      addToast(status === 'maybe' ? 'Marked as maybe.' : 'Thanks for letting us know.')
      onComplete()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Something went wrong', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmPaid() {
    if (!rsvp) return
    setPaidBusy(true)
    try {
      const { data, error } = await supabase.rpc('mark_payment_pending', { p_rsvp_id: rsvp.id })
      if (error) throw error
      if (data) setRsvp(data as RSVP)
      addToast("You're going! Your host will confirm your payment shortly.")
      setStep('going')
      onComplete()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not record that', 'error')
    } finally {
      setPaidBusy(false)
    }
  }

  const changeButton = (
    <button type="button" className="ck-btn" style={{ marginTop: 18 }} onClick={() => setStep('form')}>
      Change response
    </button>
  )

  // ---- GOING (counted) ----------------------------------------------------
  if (step === 'going') {
    const paid = rsvp?.payment_status === 'paid'
    return (
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div
          style={{ fontFamily: 'var(--ck-serif)', fontWeight: 900, fontSize: 32, color: 'var(--ck-cobalt)' }}
        >
          YOU&apos;RE GOING
        </div>
        <p className="ck-mono" style={{ marginTop: 10, opacity: 0.7 }}>
          {paid
            ? 'Payment confirmed — your ticket is on the way.'
            : 'We have your payment — your host will confirm it shortly.'}
        </p>
        {paid && rsvp?.ticket_token ? (
          <a href={`/ticket/${rsvp.ticket_token}`} className="ck-btn ck-btn--primary" style={{ marginTop: 18 }}>
            View your ticket →
          </a>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
            <button type="button" className="ck-btn" onClick={() => setStep('pay')}>
              Pay again / resend
            </button>
            <button type="button" className="ck-btn" onClick={() => setStep('form')} style={{ opacity: 0.7 }}>
              Change response
            </button>
          </div>
        )}
      </div>
    )
  }

  // ---- MAYBE --------------------------------------------------------------
  if (step === 'maybe') {
    return (
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div style={{ fontFamily: 'var(--ck-serif)', fontWeight: 900, fontSize: 32, color: 'var(--ck-cobalt)' }}>
          MAYBE
        </div>
        <p className="ck-mono" style={{ marginTop: 10, opacity: 0.7 }}>
          You&apos;re on the maybe list — no spot held. Come back to grab a ticket when you&apos;re sure.
        </p>
        {changeButton}
      </div>
    )
  }

  // ---- DECLINED -----------------------------------------------------------
  if (step === 'declined') {
    return (
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div style={{ fontFamily: 'var(--ck-serif)', fontWeight: 900, fontSize: 28 }}>
          CAN&apos;T GO
        </div>
        <p className="ck-mono" style={{ marginTop: 10, opacity: 0.7 }}>
          Thanks for the heads up — we&apos;ll keep you posted on what&apos;s next.
        </p>
        {changeButton}
      </div>
    )
  }

  // ---- SAVED (registered but said not paid) -------------------------------
  if (step === 'saved') {
    return (
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div className="ck-label" style={{ color: 'var(--ck-cobalt)' }}>
          ✦ Saved
        </div>
        <p className="ck-italic" style={{ fontSize: 19, marginTop: 8, lineHeight: 1.4 }}>
          You&apos;re not on the list yet — a ticket isn&apos;t reserved until you pay.
        </p>
        <p className="ck-mono" style={{ marginTop: 10, opacity: 0.7 }}>
          Your info is saved. Come back any time to pay and lock in your spot.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
          <button type="button" className="ck-btn ck-btn--primary" onClick={() => setStep('pay')}>
            Pay now →
          </button>
          <button type="button" className="ck-btn" onClick={() => setStep('form')} style={{ opacity: 0.7 }}>
            Change response
          </button>
        </div>
      </div>
    )
  }

  // ---- PAY (attention-commanding) -----------------------------------------
  if (step === 'pay') {
    return (
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div className="ck-mono" style={{ letterSpacing: '0.16em', opacity: 0.7 }}>
          THIS EVENT COSTS
        </div>
        <div style={{ fontFamily: 'var(--ck-serif)', fontWeight: 900, fontSize: 44, lineHeight: 1.1 }}>
          ${amount}
        </div>
        <p className="ck-italic" style={{ fontSize: 18, marginTop: 6 }}>
          Pay the host to lock in your spot.
        </p>

        {venmoHandle ? (
          <a
            href={venmoUrl}
            target={isMobile ? undefined : '_blank'}
            rel="noopener noreferrer"
            className="ck-btn ck-btn--primary"
            style={{ marginTop: 18, fontSize: 16 }}
            onClick={() => setStep('confirm')}
          >
            Pay ${amount} on Venmo →
          </a>
        ) : (
          <p className="ck-mono" style={{ marginTop: 18, color: 'var(--ck-magenta)' }}>
            Venmo isn&apos;t set up yet — ask your host.
          </p>
        )}

        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="ck-btn"
            onClick={() => setStep('confirm')}
            style={{ background: 'transparent', border: '2px solid transparent', opacity: 0.7 }}
          >
            I&apos;ve already paid
          </button>
        </div>
      </div>
    )
  }

  // ---- CONFIRM ("did you pay?") -------------------------------------------
  if (step === 'confirm') {
    return (
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div style={{ fontFamily: 'var(--ck-serif)', fontWeight: 800, fontSize: 24, lineHeight: 1.2 }}>
          Did you send ${amount} to the host?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
          <button type="button" className="ck-btn ck-btn--primary" onClick={handleConfirmPaid} disabled={paidBusy}>
            {paidBusy ? 'Saving…' : `Yes, I've paid $${amount}`}
          </button>
          <button type="button" className="ck-btn" onClick={() => setStep('saved')} disabled={paidBusy}>
            No, not yet
          </button>
        </div>
        <p className="ck-mono" style={{ marginTop: 14, opacity: 0.6, fontSize: 11 }}>
          Trust-based — your host verifies the Venmo and sends your ticket.
        </p>
      </div>
    )
  }

  // ---- FORM (choose a response) -------------------------------------------
  return (
    <form onSubmit={e => e.preventDefault()} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p className="ck-italic" style={{ fontSize: 18, lineHeight: 1.4 }}>
        ${amount} per person. Going? Enter your info, then pay to lock in your spot.
      </p>
      <Field label="Name" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Your first name" required />
      <Field label="Last name" optional value={lastName} onChange={e => setLastName(e.target.value)} />
      {smsEnabled && (
        <Field label="Phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Required if no email" />
      )}
      <Field label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        <button
          type="button"
          onClick={handleGoing}
          disabled={loading}
          className="ck-btn ck-btn--primary"
          style={{ flex: '1 1 200px' }}
        >
          {loading ? 'Saving…' : 'Going — reserve a seat →'}
        </button>
        <button type="button" onClick={() => handleResponse('maybe')} disabled={loading} className="ck-btn">
          Maybe
        </button>
        <button
          type="button"
          onClick={() => handleResponse('no')}
          disabled={loading}
          className="ck-btn"
          style={{ background: 'transparent', border: '2px solid transparent', opacity: 0.6 }}
        >
          Can&apos;t go
        </button>
      </div>
      <p className="ck-mono" style={{ opacity: 0.6, fontSize: 11 }}>
        Maybe / Can&apos;t go just save your info — no spot held, nothing to pay.
      </p>
      <ConsentNote verb="rsvp" />
    </form>
  )
}
