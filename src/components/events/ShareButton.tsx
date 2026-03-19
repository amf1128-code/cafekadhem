import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getGuestToken } from '../../lib/utils/guest-token'
import { shareLink } from '../../lib/utils/share'
import { useToast } from '../ui/Toast'

interface ShareButtonProps {
  eventId: string
  eventTitle: string
}

export function ShareButton({ eventId, eventTitle }: ShareButtonProps) {
  const { addToast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleShare() {
    setLoading(true)

    try {
      const guestToken = getGuestToken()

      // Create invite with token
      const { data: invite } = await supabase
        .from('invites')
        .insert({
          event_id: eventId,
          invited_by: guestToken,
        })
        .select('token')
        .single()

      if (!invite) throw new Error('Failed to create share link')

      const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin
      const url = `${siteUrl}/invite/${invite.token}`

      const shared = await shareLink(url, `Join me at ${eventTitle}`)
      if (shared) {
        addToast('Link copied!')
      }
    } catch (err) {
      addToast('Failed to create share link', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleShare}
      disabled={loading}
      className="border border-warm px-6 py-2.5 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors disabled:opacity-50"
    >
      {loading ? 'Creating link...' : '[ Share Event ]'}
    </button>
  )
}
