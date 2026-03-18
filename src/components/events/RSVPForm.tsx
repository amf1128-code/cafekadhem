import { useState, useEffect, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { RSVP } from '../../lib/types'
import { getGuestToken, setGuestToken } from '../../lib/utils/guest-token'
import { normalizePhone } from '../../lib/utils/phone'
import { normalizeInstagram, isValidInstagram } from '../../lib/utils/instagram'
import { sendNotification } from '../../lib/notifications'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'

interface RSVPFormProps {
  eventId: string
  existingRsvp: RSVP | null
  isFull: boolean
  onRsvpComplete: () => void
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
      <div className="text-center">
        <p className="text-ink/70 mb-2">
          Your RSVP: <span className={`font-medium ${isWaitlisted ? 'text-amber-700' : 'text-forest'}`}>
            {statusLabels[existingRsvp.status] || existingRsvp.status}
          </span>
        </p>
        {isWaitlisted && existingRsvp.waitlist_position && (
          <p className="text-sm text-ink/50 mb-2">Position #{existingRsvp.waitlist_position} on the waitlist</p>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          Change RSVP
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={(e: FormEvent) => e.preventDefault()} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="First Name"
          value={firstName}
          onChange={e => setFirstName(e.target.value)}
          required
        />
        <Input
          label="Last Name"
          value={lastName}
          onChange={e => setLastName(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="Required if no phone"
      />
      <Input
        label="Phone"
        type="tel"
        value={phone}
        onChange={e => setPhone(e.target.value)}
        placeholder="Required if no email"
      />
      <Input
        label="Instagram"
        value={instagram}
        onChange={e => setInstagram(e.target.value)}
        placeholder="Optional (without @)"
      />
      <Select
        label="Notification preference"
        value={notifPref}
        onChange={e => setNotifPref(e.target.value)}
        options={[
          { value: 'email', label: 'Email' },
          { value: 'sms', label: 'SMS' },
          { value: 'none', label: 'None' },
        ]}
      />

      <div className="flex gap-2 pt-2">
        <Button onClick={() => handleRSVP('yes')} loading={loading} className="flex-1">
          {isFull ? 'Join Waitlist' : 'Yes'}
        </Button>
        <Button onClick={() => handleRSVP('maybe')} loading={loading} variant="secondary" className="flex-1">
          Maybe
        </Button>
        <Button onClick={() => handleRSVP('no')} loading={loading} variant="ghost" className="flex-1">
          No
        </Button>
      </div>
    </form>
  )
}
