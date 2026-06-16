import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { getGuestToken, setGuestToken } from '../../../lib/utils/guest-token'
import { buildVenmoNote } from '../../../lib/payment/venmo'
import { normalizePhone, isValidPhone } from '../../../lib/utils/phone'
import { useToast } from '../../ui/Toast'
import { CinemaPageLoader } from '../primitives'

// /door/:token — capacity-bypassing register + pay page, reached by
// scanning the per-event QR the host shows at the door. Lets a waitlisted
// guest or a walk-up grab a spot and pay even when the event is "sold out."
// Verification is "provisional": the guest self-attests payment and the
// host reconciles on the check-in console.

interface DoorEvent {
  ok: boolean
  event_id?: string
  title?: string
  ticket_price?: number | null
  ticketing_enabled?: boolean
}

type Step = 'form' | 'pay' | 'done' | 'already'

export function CinemaDoor() {
  const { token } = useParams<{ token: string }>()
  const { addToast } = useToast()
  const [info, setInfo] = useState<DoorEvent | null>(null)
  const [venmoHandle, setVenmoHandle] = useState('')
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<Step>('form')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [rsvpId, setRsvpId] = useState<string | null>(null)
  const [ticketToken, setTicketToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isMobile =
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token) {
        setLoading(false)
        return
      }
      const [{ data: resolved }, { data: settingsRow }] = await Promise.all([
        supabase.rpc('resolve_door_token', { p_token: token }),
        supabase.from('admin_settings').select('venmo_handle').limit(1).single(),
      ])
      if (cancelled) return
      setInfo((resolved as DoorEvent) ?? { ok: false })
      if (settingsRow?.venmo_handle) setVenmoHandle(settingsRow.venmo_handle)

      // Prefill from a known guest so a returning visitor doesn't retype.
      const guestToken = getGuestToken()
      if (guestToken) {
        const { data } = await supabase.rpc('get_my_guest', { p_guest_id: guestToken })
        if (!cancelled && data) {
          setFirstName(data.first_name || '')
          setLastName(data.last_name || '')
          setEmail(data.email || '')
          setPhone(data.phone || '')
        }
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const amount = (info?.ticket_price ?? 0).toFixed(2)
  const note = encodeURIComponent(
    buildVenmoNote({ firstName: firstName || 'Ticket', eventTitle: info?.title || 'Cafe Kadhem' }),
  )
  const venmoUrl = venmoHandle
    ? isMobile
      ? `venmo://paycharge?txn=pay&recipients=${venmoHandle}&amount=${amount}&note=${note}`
      : `https://venmo.com/${venmoHandle}?txn=pay&amount=${amount}&note=${note}`
    : ''

  async function handleRegister() {
    if (!firstName.trim()) {
      addToast('Please enter your name.', 'error')
      return
    }
    if (!phone.trim() && !email.trim()) {
      addToast('Please add a phone number (or email).', 'error')
      return
    }
    if (phone.trim() && !isValidPhone(phone.trim())) {
      addToast('Please enter a valid US phone number.', 'error')
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('door_register', {
        p_token: token,
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim() || null,
        p_email: email.trim() || null,
        p_phone: phone.trim() ? normalizePhone(phone.trim()) : null,
      })
      if (error) throw error
      const res = data as {
        rsvp_id: string
        guest_id: string
        already_paid: boolean
        ticket_token: string | null
      }
      if (res.guest_id) setGuestToken(res.guest_id)
      setRsvpId(res.rsvp_id)
      setTicketToken(res.ticket_token)
      setStep(res.already_paid ? 'already' : 'pay')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Something went wrong', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleAttest() {
    if (!rsvpId) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('door_attest_paid', { p_token: token, p_rsvp_id: rsvpId })
      if (error) throw error
      setStep('done')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not record that', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <CinemaPageLoader />

  if (!info?.ok) {
    return (
      <section className="ck-page" style={{ textAlign: 'center', borderBottom: 'none' }}>
        <div className="ck-narrow">
          <div className="ck-eyebrow">✦ Hmm</div>
          <h1 className="ck-h1" style={{ marginTop: 12 }}>
            DOOR LINK
            <br />
            <span className="ck-italic">expired</span>
          </h1>
          <p className="ck-italic" style={{ fontSize: 18, marginTop: 18 }}>
            This code isn’t valid anymore — ask the staff to show you the current door QR.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="ck-page" style={{ borderBottom: 'none' }}>
      <div className="ck-narrow">
        <div className="ck-eyebrow">✦ At the door</div>
        <h1 className="ck-h1" style={{ marginTop: 12 }}>
          {info.title}
        </h1>

        <div className="ck-card" style={{ marginTop: 22, padding: 24, background: 'var(--ck-cream)' }}>
          {step === 'form' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p className="ck-italic" style={{ fontSize: 18, lineHeight: 1.4 }}>
                Grab a spot right now — pop in your details, then pay the host. {amount !== '0.00' && `$${amount} per person.`}
              </p>
              <Field label="Name" value={firstName} onChange={setFirstName} placeholder="Your first name" />
              <Field label="Last name" optional value={lastName} onChange={setLastName} />
              <Field label="Phone" type="tel" value={phone} onChange={setPhone} placeholder="(555) 555-5555" />
              <Field label="Email" optional type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
              <button
                type="button"
                className="ck-btn ck-btn--primary"
                onClick={handleRegister}
                disabled={busy}
                style={{ marginTop: 4 }}
              >
                {busy ? 'Saving…' : 'Continue to pay →'}
              </button>
            </div>
          )}

          {step === 'pay' && (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div className="ck-mono" style={{ letterSpacing: '0.16em', opacity: 0.7 }}>
                PAY THE HOST
              </div>
              <div style={{ fontFamily: 'var(--ck-serif)', fontWeight: 900, fontSize: 44, lineHeight: 1.1 }}>
                ${amount}
              </div>
              {venmoHandle ? (
                <a
                  href={venmoUrl}
                  target={isMobile ? undefined : '_blank'}
                  rel="noopener noreferrer"
                  className="ck-btn ck-btn--primary"
                  style={{ marginTop: 18, fontSize: 16 }}
                >
                  Pay ${amount} on Venmo →
                </a>
              ) : (
                <p className="ck-mono" style={{ marginTop: 18, color: 'var(--ck-magenta)' }}>
                  Ask the host how to pay.
                </p>
              )}
              <div style={{ marginTop: 16 }}>
                <button type="button" className="ck-btn ck-btn--primary ck-btn--block" onClick={handleAttest} disabled={busy}>
                  {busy ? 'Saving…' : `I've paid $${amount} →`}
                </button>
              </div>
              <p className="ck-mono" style={{ marginTop: 14, opacity: 0.6, fontSize: 11 }}>
                Tap “I’ve paid” and show the next screen to the host.
              </p>
            </div>
          )}

          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ fontFamily: 'var(--ck-serif)', fontWeight: 900, fontSize: 32, color: 'var(--ck-cobalt)' }}>
                YOU’RE IN
              </div>
              <p className="ck-italic" style={{ fontSize: 18, marginTop: 8 }}>
                Show this to the host{firstName.trim() ? ` — ${firstName.trim()}` : ''}.
              </p>
              <p className="ck-mono" style={{ marginTop: 10, opacity: 0.7 }}>
                They’ll confirm your payment and wave you in. Hang tight!
              </p>
            </div>
          )}

          {step === 'already' && (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ fontFamily: 'var(--ck-serif)', fontWeight: 900, fontSize: 30, color: 'var(--ck-cobalt)' }}>
                YOU’RE ALREADY IN
              </div>
              <p className="ck-italic" style={{ fontSize: 18, marginTop: 8 }}>
                We’ve got your payment — no need to pay again.
              </p>
              {ticketToken && (
                <Link to={`/ticket/${ticketToken}`} className="ck-btn ck-btn--primary" style={{ marginTop: 18 }}>
                  View your ticket →
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function Field({
  label,
  optional,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  optional?: boolean
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label className="ck-label">
        {label}
        {optional && <span style={{ opacity: 0.5, marginLeft: 6 }}>· optional</span>}
      </label>
      <input
        className="ck-input"
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}
