import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { normalizePhone, isValidPhone } from '../../lib/utils/phone'
import { getGuestToken } from '../../lib/utils/guest-token'
import { sendInviteNotification } from '../../lib/notifications'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useToast } from '../ui/Toast'

interface InviteFormProps {
  eventId: string
}

export function InviteForm({ eventId }: InviteFormProps) {
  const { addToast } = useToast()
  const [contact, setContact] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    if (!contact.trim()) return

    setSending(true)

    try {
      const isEmail = contact.includes('@')
      const isPhone = !isEmail && isValidPhone(contact)

      if (!isEmail && !isPhone) {
        addToast('Please enter a valid email or phone number', 'error')
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
    <form onSubmit={handleSend} className="flex gap-2">
      <Input
        value={contact}
        onChange={e => setContact(e.target.value)}
        placeholder="Friend's email or phone"
        className="flex-1"
      />
      <Button type="submit" loading={sending} size="sm">
        Invite
      </Button>
    </form>
  )
}
