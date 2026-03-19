import { useState, useEffect, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { RSVP } from '../../lib/types'
import { getGuestToken, setGuestToken } from '../../lib/utils/guest-token'
import { normalizePhone } from '../../lib/utils/phone'
import { normalizeInstagram, isValidInstagram } from '../../lib/utils/instagram'
import { sendNotification } from '../../lib/notifications'
import { useToast } from '../ui/Toast'

interface RSVPFormProps {
  eventId: string
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
        className="flex-1 border-0 border-b border-stone bg-transparent py-2 font-script text-lg text-ink italic placeholder:text-stone-dark placeholder:italic outline-none focus:border-ink transition-colors"
        {...props}
      />
    </div>
  )
}

export function RSVPForm({ eventId, existingRsvp, isFull, onRsvpComplete }: RSVPFormProps) {
  const { addToast } = useToast()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [instagram, setInstagram] = useState('')
  const [notifPref, setNotifPref] = useState('email')
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(!existingRsvp)

  useEffect(() => {
    const guestToken = getGuestToken()
    if (guestToken) {
      supabase
        .from('guests')
        .select('*')
        .eq('id', guestToken)
        .single()
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
    if (instagram && !isValidInstagram(instagram)) {
      addToast('Invalid Instagram handle format.', 'error')
      return
    }

    setLoading(true)

    try {
      let guestId = getGuestToken()

      const guestData = {
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() ? normalizePhone(phone.trim()) : null,
        instagram: instagram.trim() ? normalizeInstagram(instagram.trim()) : null,
        notification_preference: notifPref,
      }

      if (guestId) {
        // Update existing guest
        await supabase.from('guests').update(guestData).eq('id', guestId)
      } else {
        // Check for dedup by email or phone
        let existing = null
        if (guestData.email) {
          const { data } = await supabase
            .from('guests')
            .select('id')
            .eq('email', guestData.email)
            .limit(1)
            .single()
          existing = data
        }
        if (!existing && guestData.phone) {
          const { data } = await supabase
            .from('guests')
            .select('id')
            .eq('phone', guestData.phone)
            .limit(1)
            .single()
          existing = data
        }

        if (existing) {
          guestId = existing.id
          await supabase.from('guests').update(guestData).eq('id', guestId)
        } else {
          const { data: newGuest } = await supabase
            .from('guests')
            .insert(guestData)
            .select('id')
            .single()
          if (newGuest) guestId = newGuest.id
        }
      }

      if (!guestId) throw new Error('Failed to create guest record')
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
        sendNotification({
          guestId,
          eventId,
          type: 'rsvp_confirmation',
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
    return (
      <div className="text-center py-4">
        <p className="font-serif text-xl text-ink italic mb-1">
          Your RSVP: <span className={isWaitlisted ? 'text-accent' : 'text-ink'}>
            {statusLabels[existingRsvp.status] || existingRsvp.status}
          </span>
        </p>
        {isWaitlisted && existingRsvp.waitlist_position && (
          <p className="text-sm text-ink-muted mb-3">Position #{existingRsvp.waitlist_position} on the waitlist</p>
        )}
        <button
          onClick={() => setShowForm(true)}
          className="border border-stone px-6 py-2 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors"
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
          className="flex-1 border-0 border-b border-stone bg-transparent py-2 font-script text-lg text-ink italic outline-none focus:border-ink transition-colors appearance-none cursor-pointer"
        >
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="none">None</option>
        </select>
      </div>

      {/* RSVP buttons — bracket style */}
      <div className="flex justify-center pt-4">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => handleRSVP('yes')}
            disabled={loading}
            className="border border-stone px-8 py-3 text-xs tracking-[0.2em] uppercase text-ink hover:border-ink hover:bg-ink hover:text-parchment transition-colors disabled:opacity-50"
          >
            [ {isFull ? 'Join Waitlist' : 'Reserve a Seat'} ]
          </button>
          <button
            type="button"
            onClick={() => handleRSVP('maybe')}
            disabled={loading}
            className="border border-stone px-6 py-3 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors disabled:opacity-50"
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
