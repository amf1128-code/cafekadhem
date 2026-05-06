import { useState, useEffect, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { RSVP, Event, AdminSettings, PublicGuestProfile } from '../../lib/types'
import { getGuestToken, setGuestToken } from '../../lib/utils/guest-token'
import { dispatchMergeVerification, type PendingMerge } from '../../lib/identity/handlePendingMerge'
import { ConsentNote } from '../ui/ConsentNote'
import { ShareButton } from '../ui/ShareButton'
import { normalizePhone, isValidPhone } from '../../lib/utils/phone'
import { normalizeInstagram, isValidInstagram } from '../../lib/utils/instagram'
import { sendNotification } from '../../lib/notifications'
import { useToast } from '../ui/Toast'

type RSVPWithGuest = RSVP & { guest: PublicGuestProfile }

interface RSVPFormProps {
  eventId: string
  event?: Event | null
  existingRsvp: RSVP | null
  existingPlusOne: RSVPWithGuest | null
  isFull: boolean
  onRsvpComplete: () => void
}

function CinemaField({
  label,
  optional,
  ...props
}: {
  label: string
  optional?: boolean
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label className="ck-label">
        {label}
        {optional && (
          <span style={{ opacity: 0.5, marginLeft: 6 }}>· optional</span>
        )}
      </label>
      <input className="ck-input" {...props} />
    </div>
  )
}

export function RSVPForm({ eventId, event, existingRsvp, existingPlusOne, isFull, onRsvpComplete }: RSVPFormProps) {
  const { addToast } = useToast()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [instagram, setInstagram] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(!existingRsvp)
  const [venmoHandle, setVenmoHandle] = useState<string>('')
  // Default to "SMS off" so the phone input never flashes visible while
  // the admin_settings fetch is in flight. Flips on only if the saved
  // setting says so.
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  // Plus-one state. The toggle is shown on every non-ticketed event,
  // including the edit flow — when the host already has a +1 the toggle
  // is prefilled on with their name, so they can rename, replace, or
  // remove the +1 from the same form.
  // Ticketed events stay opted out for now: a +1 there would require a
  // second seat purchase, which the current Venmo flow doesn't model.
  const [plusOne, setPlusOne] = useState(!!existingPlusOne)
  const [plusOneName, setPlusOneName] = useState(existingPlusOne?.guest?.first_name || '')
  const showPlusOneToggle = !event?.ticketing_enabled

  // Resync local plus-one state when the parent re-fetches and hands us
  // a fresh existingPlusOne (e.g. after a successful submit).
  useEffect(() => {
    setPlusOne(!!existingPlusOne)
    setPlusOneName(existingPlusOne?.guest?.first_name || '')
  }, [existingPlusOne])

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
            // notification_preference is no longer user-set in the public
            // form; it's inferred at upsert_guest time from filled fields
            // (USER_FLOWS_SPEC.md §7.1). Existing values on the row are
            // preserved by the server.
          }
        })
    }
  }, [])

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
    if (instagram && !isValidInstagram(instagram)) {
      addToast('Invalid Instagram handle format.', 'error')
      return
    }
    // Plus-one is only attempted alongside an actual reservation. If
    // the user toggled it on but left the name blank, ask before
    // submitting (rather than silently dropping their +1 intent).
    // 'maybe'/'no' submits ignore the toggle — a +1 there will get
    // cleaned up below if one existed.
    if (showPlusOneToggle && plusOne && status === 'yes' && !plusOneName.trim()) {
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
        // notification_preference omitted: server infers from filled
        // fields per USER_FLOWS_SPEC.md §7.1.
      }
      if (smsEnabled) {
        fields.phone = phone.trim() ? normalizePhone(phone.trim()) : null
      }

      // When editing an existing RSVP, prefer the DB-authoritative guest_id
      // from the RSVP row over the localStorage token. The token can be stale
      // (e.g. after the form unmounts/remounts during loadEvent), which would
      // make upsert_guest fall through to the dedup/insert path and risk
      // returning a different guest than the one the RSVP belongs to.
      const guestIdHint = existingRsvp?.guest_id ?? getGuestToken()

      const { data: guest, error: guestErr } = await supabase.rpc('upsert_guest', {
        p_fields: fields,
        p_guest_id: guestIdHint,
      })
      if (guestErr) throw guestErr
      if (!guest) throw new Error('Failed to create guest record')
      const guestId = guest.id as string
      setGuestToken(guestId)

      // Case B identity collision (USER_FLOWS_SPEC.md §3.4): the typed
      // contact matched a different existing guest than the one in
      // localStorage. Dispatch the verification link to the matched
      // channel; the RSVP itself proceeds against the matched guest.
      const pendingMerge = (guest as { pending_merge?: PendingMerge }).pending_merge
      if (pendingMerge?.verification_token) {
        void dispatchMergeVerification(pendingMerge)
      }

      // Capture ?ref= (soft attribution from a shared link). One-shot:
      // set_rsvp_referrer only writes if the column is currently NULL,
      // so re-RSVPs don't overwrite the original referrer.
      // USER_FLOWS_SPEC.md §3a.8.
      const refGuestId = new URLSearchParams(window.location.search).get('ref')

      // Use safe_create_rsvp function for capacity enforcement
      const { data: rsvpResult, error: rsvpError } = await supabase.rpc('safe_create_rsvp', {
        p_event_id: eventId,
        p_guest_id: guestId,
        p_status: status,
      })

      if (rsvpError) throw rsvpError

      // Persist the ?ref= attribution (one-shot, ignored if already set).
      if (refGuestId) {
        void supabase.rpc('set_rsvp_referrer', {
          p_event_id: eventId,
          p_guest_id: guestId,
          p_referrer_id: refGuestId,
        })
      }

      // Plus-one reconciliation. Four shapes to consider, run after the
      // host's RSVP has been upserted:
      //   - status is 'no'/'maybe' and a +1 existed -> remove (a +1 only
      //     makes sense alongside an actual reservation).
      //   - status is 'yes'/'waitlisted' and the toggle changed/diverged
      //     from existingPlusOne -> add / rename / remove.
      // `plusOneOutcome` carries the resulting state so the toast can
      // describe what happened.
      let plusOneOutcome:
        | { kind: 'added'; status?: string; name: string }
        | { kind: 'renamed'; name: string }
        | { kind: 'removed'; name: string }
        | { kind: 'cleared'; name: string }
        | null = null
      const wantPlusOneNow = showPlusOneToggle && plusOne && (status === 'yes' || status === 'maybe')
      // Only 'yes' actually attempts to seat the +1; 'maybe' clears any
      // existing +1 because a +1 isn't a thing without a reservation.
      // 'no' obviously also clears.
      if (status === 'no' || status === 'maybe') {
        if (existingPlusOne) {
          const { error: rmErr } = await supabase.rpc('remove_plus_one', {
            p_plus_one_rsvp_id: existingPlusOne.id,
          })
          if (rmErr) {
            addToast(`RSVP saved, but couldn't remove your +1: ${rmErr.message}`, 'error')
          } else {
            plusOneOutcome = { kind: 'cleared', name: existingPlusOne.guest.first_name }
          }
        }
      } else if (rsvpResult?.id) {
        // status is 'yes' or 'waitlisted'
        const trimmedName = plusOneName.trim()
        if (existingPlusOne && !wantPlusOneNow) {
          // Toggle was turned off
          const { error: rmErr } = await supabase.rpc('remove_plus_one', {
            p_plus_one_rsvp_id: existingPlusOne.id,
          })
          if (rmErr) {
            addToast(`RSVP saved, but couldn't remove your +1: ${rmErr.message}`, 'error')
          } else {
            plusOneOutcome = { kind: 'removed', name: existingPlusOne.guest.first_name }
          }
        } else if (existingPlusOne && wantPlusOneNow) {
          // Same +1, possibly renamed
          if (trimmedName && trimmedName !== existingPlusOne.guest.first_name) {
            const { error: rnErr } = await supabase.rpc('rename_plus_one', {
              p_plus_one_rsvp_id: existingPlusOne.id,
              p_first_name: trimmedName,
            })
            if (rnErr) {
              addToast(`RSVP saved, but couldn't rename your +1: ${rnErr.message}`, 'error')
            } else {
              plusOneOutcome = { kind: 'renamed', name: trimmedName }
            }
          }
        } else if (!existingPlusOne && wantPlusOneNow) {
          // Net-new +1
          const { data: poData, error: poError } = await supabase.rpc('add_plus_one', {
            p_parent_rsvp_id: rsvpResult.id,
            p_first_name: trimmedName,
          })
          if (poError) {
            addToast(`RSVP saved, but couldn't add your +1: ${poError.message}`, 'error')
          } else {
            plusOneOutcome = {
              kind: 'added',
              status: poData?.status,
              name: trimmedName,
            }
          }
        }
        // else: no existing +1, toggle off — nothing to do
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
      let plusOneSuffix = ''
      if (plusOneOutcome) {
        if (plusOneOutcome.kind === 'added') {
          plusOneSuffix = plusOneOutcome.status === 'waitlisted'
            ? ` Your +1 ${plusOneOutcome.name} is on the waitlist — capacity was hit on this seat.`
            : ` ${plusOneOutcome.name} is in too.`
        } else if (plusOneOutcome.kind === 'renamed') {
          plusOneSuffix = ` Your +1 is now ${plusOneOutcome.name}.`
        } else if (plusOneOutcome.kind === 'removed') {
          plusOneSuffix = ` ${plusOneOutcome.name} was removed from your reservation.`
        } else if (plusOneOutcome.kind === 'cleared') {
          plusOneSuffix = ` ${plusOneOutcome.name} was removed (a +1 only applies when you're going).`
        }
      }
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
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div className="ck-label" style={{ marginBottom: 6 }}>
          Your RSVP
        </div>
        <div
          style={{
            fontFamily: 'var(--ck-serif)',
            fontWeight: 900,
            fontSize: 32,
            lineHeight: 1,
            color: isWaitlisted ? 'var(--ck-magenta)' : 'var(--ck-cobalt)',
          }}
        >
          {(statusLabels[existingRsvp.status] || existingRsvp.status).toUpperCase()}
        </div>
        {isWaitlisted && existingRsvp.waitlist_position && (
          <div className="ck-mono" style={{ marginTop: 6, opacity: 0.7 }}>
            Position #{existingRsvp.waitlist_position} on the waitlist
          </div>
        )}
        {existingPlusOne && (
          <div className="ck-mono" style={{ marginTop: 8, opacity: 0.75 }}>
            Bringing{' '}
            <span style={{ color: 'var(--ck-cobalt)' }}>
              {existingPlusOne.guest.first_name}
            </span>{' '}
            +1
          </div>
        )}

        {showPaymentFlow && (
          <div
            className="ck-card ck-card--paper"
            style={{ marginTop: 22, padding: 20, textAlign: 'left' }}
          >
            <div className="ck-label" style={{ color: 'var(--ck-cobalt)' }}>
              ✦ Ticket payment
            </div>
            {existingRsvp.payment_status === 'pending' ? (
              <>
                <p
                  className="ck-italic"
                  style={{ fontSize: 17, marginTop: 8, lineHeight: 1.4 }}
                >
                  Payment received — awaiting confirmation.
                </p>
                <p
                  style={{
                    fontFamily: 'var(--ck-sans)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    marginTop: 8,
                    opacity: 0.75,
                  }}
                >
                  Your host will verify the Venmo and send your QR-code ticket.
                  If you haven&apos;t sent it yet, resend below.
                </p>
              </>
            ) : (
              <>
                <p
                  className="ck-italic"
                  style={{ fontSize: 17, marginTop: 8, lineHeight: 1.4 }}
                >
                  Send{' '}
                  <span
                    style={{
                      fontStyle: 'normal',
                      fontFamily: 'var(--ck-serif)',
                      fontWeight: 800,
                    }}
                  >
                    ${amount}
                  </span>{' '}
                  via Venmo to confirm your seat.
                </p>
                <p
                  style={{
                    fontFamily: 'var(--ck-sans)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    marginTop: 8,
                    opacity: 0.75,
                  }}
                >
                  The note must include your name and the event title so your
                  host can match the payment.
                </p>
              </>
            )}
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 14,
                flexWrap: 'wrap',
              }}
            >
              {venmoHandle && (
                <a
                  href={isMobile ? venmoMobileUrl : venmoWebUrl}
                  target={isMobile ? undefined : '_blank'}
                  rel="noopener noreferrer"
                  className="ck-btn ck-btn--primary"
                >
                  Pay ${amount} on Venmo →
                </a>
              )}
              <button
                type="button"
                onClick={handleMarkPaymentPending}
                disabled={markingPaid || existingRsvp.payment_status === 'pending'}
                className="ck-btn"
              >
                {existingRsvp.payment_status === 'pending'
                  ? 'Marked as paid'
                  : markingPaid
                    ? 'Recording…'
                    : "I've paid"}
              </button>
            </div>
          </div>
        )}

        {showTicketLink && (
          <div style={{ marginTop: 22 }}>
            <a
              href={`/ticket/${existingRsvp.ticket_token}`}
              className="ck-btn ck-btn--primary"
            >
              View your ticket →
            </a>
            <p
              className="ck-mono"
              style={{ marginTop: 10, opacity: 0.65 }}
            >
              Also sent via{' '}
              {existingRsvp.checked_in_at ? 'your preferred channel' : 'email or SMS'}.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="ck-btn"
          style={{ marginTop: 22 }}
        >
          Change RSVP
        </button>

        {/* Share affordance — shows on yes / waitlisted RSVPs.
            URL carries ?ref=<sharer_guest_id> for soft attribution.
            USER_FLOWS_SPEC.md §3a.8. */}
        {event && (existingRsvp.status === 'yes' || existingRsvp.status === 'waitlisted') && (
          <div style={{ marginTop: 22 }}>
            <ShareButton
              url={`${window.location.origin}/events/${eventId}?ref=${existingRsvp.guest_id}`}
              title={event.title}
              text={`I'm going to ${event.title} at Cafe Kadhem — want to join?`}
              label="Tell your friends"
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={(e: FormEvent) => e.preventDefault()}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <CinemaField
        label="Name"
        value={firstName}
        onChange={e => setFirstName(e.target.value)}
        placeholder="Your first name"
        required
      />
      <CinemaField
        label="Last name"
        optional
        value={lastName}
        onChange={e => setLastName(e.target.value)}
      />
      <CinemaField
        label="Email"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@example.com"
      />
      {smsEnabled && (
        <CinemaField
          label="Phone"
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="Required if no email"
        />
      )}
      <CinemaField
        label="Instagram"
        optional
        value={instagram}
        onChange={e => setInstagram(e.target.value)}
        placeholder="(without @)"
      />

      {/* Plus-one toggle. Only shown for first-time RSVPs to non-ticketed
          events; the +1 is created when the user clicks Reserve a Seat. */}
      {showPlusOneToggle && (
        <div
          style={{
            marginTop: 4,
            padding: 14,
            border: '2px solid var(--ck-ink)',
            background: 'var(--ck-paper)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              fontFamily: 'var(--ck-mono)',
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
            }}
          >
            <input
              type="checkbox"
              checked={plusOne}
              onChange={e => setPlusOne(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--ck-cobalt)' }}
            />
            Bringing a +1?
          </label>
          {plusOne && (
            <CinemaField
              label="+1 Name"
              value={plusOneName}
              onChange={e => setPlusOneName(e.target.value)}
              placeholder="Their first name"
            />
          )}
        </div>
      )}

      {/* RSVP buttons.
          Server-side guard: safe_create_rsvp (migration 033) blocks
          status changes away from 'yes' on paid RSVPs. If a guest
          tries, they'll get a toast — refund flow is host-managed. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 6,
        }}
      >
        <button
          type="button"
          onClick={() => handleRSVP('yes')}
          disabled={loading}
          className="ck-btn ck-btn--primary"
          style={{ flex: '1 1 200px' }}
        >
          {loading ? 'Saving…' : isFull ? 'Join waitlist →' : 'Reserve a seat →'}
        </button>
        <button
          type="button"
          onClick={() => handleRSVP('maybe')}
          disabled={loading}
          className="ck-btn"
        >
          Maybe
        </button>
        <button
          type="button"
          onClick={() => handleRSVP('no')}
          disabled={loading}
          className="ck-btn"
          style={{
            background: 'transparent',
            border: '2px solid transparent',
            opacity: 0.6,
          }}
        >
          Decline
        </button>
      </div>
      <ConsentNote verb="rsvp" />
    </form>
  )
}
