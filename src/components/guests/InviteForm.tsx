import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { normalizePhone, isValidPhone } from '../../lib/utils/phone'
import { getGuestToken } from '../../lib/utils/guest-token'
import { sendInviteNotification } from '../../lib/notifications'
import { useToast } from '../ui/Toast'
import { ConsentNote } from '../ui/ConsentNote'

interface InviteFormProps {
  eventId: string
}

export function InviteForm({ eventId }: InviteFormProps) {
  const { addToast } = useToast()
  const [contact, setContact] = useState('')
  const [sending, setSending] = useState(false)
  const [smsEnabled, setSmsEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('admin_settings')
      .select('sms_enabled')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) setSmsEnabled(!!data.sms_enabled)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    if (!contact.trim()) return

    setSending(true)

    try {
      const isEmail = contact.includes('@')
      const isPhone = !isEmail && smsEnabled && isValidPhone(contact)

      if (!isEmail && !isPhone) {
        addToast(
          smsEnabled
            ? 'Please enter a valid email or phone number'
            : 'Please enter a valid email address',
          'error',
        )
        setSending(false)
        return
      }

      const guestToken = getGuestToken()

      // Get inviter name
      let invitedByName: string | undefined
      if (guestToken) {
        const { data: guest } = await supabase
          .from('public_guest_profiles')
          .select('first_name')
          .eq('id', guestToken)
          .single()
        if (guest) invitedByName = guest.first_name
      }

      // Create invite record
      const { data: invite } = await supabase
        .from('invites')
        .insert({
          event_id: eventId,
          invited_by: guestToken,
          invited_email: isEmail ? contact.trim() : null,
          invited_phone: isPhone ? normalizePhone(contact.trim()) : null,
        })
        .select('token')
        .single()

      if (!invite) throw new Error('Failed to create invite')

      // Send notification
      const contactInfo = isEmail
        ? { email: contact.trim() }
        : { phone: normalizePhone(contact.trim()) }

      await sendInviteNotification(eventId, contactInfo, invite.token, invitedByName)

      addToast('Invite sent!')
      setContact('')
    } catch (err) {
      addToast('Failed to send invite', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <form onSubmit={handleSend} className="flex gap-3 items-end">
        <div className="flex-1 flex items-baseline gap-4">
          <label className="text-[10px] tracking-[0.2em] uppercase text-ink-muted whitespace-nowrap">
            Contact
          </label>
          <input
            type={smsEnabled ? 'text' : 'email'}
            value={contact}
            onChange={e => setContact(e.target.value)}
            placeholder={smsEnabled ? "Friend's email or phone" : "Friend's email"}
            className="flex-1 border-0 border-b border-warm bg-transparent py-2 font-script text-lg text-ink italic placeholder:text-stone-dark placeholder:italic outline-none focus:border-ink transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={sending}
          className="border border-warm px-5 py-2 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {sending ? '...' : '[ Send ]'}
        </button>
      </form>
      <ConsentNote verb="invite" />
    </div>
  )
}
