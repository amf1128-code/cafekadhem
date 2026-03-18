import { useState, useEffect } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Invite } from '../lib/types'
import { PageLoader } from '../components/ui/LoadingSpinner'

export function InviteLanding() {
  const { token } = useParams<{ token: string }>()
  const [invite, setInvite] = useState<Invite | null>(null)
  const [inviterName, setInviterName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (token) loadInvite()
  }, [token])

  async function loadInvite() {
    const { data } = await supabase
      .from('invites')
      .select('*')
      .eq('token', token!)
      .single()

    if (data) {
      setInvite(data)
      if (data.invited_by) {
        const { data: guest } = await supabase
          .from('public_guest_profiles')
          .select('first_name')
          .eq('id', data.invited_by)
          .single()
        if (guest) setInviterName(guest.first_name)
      }
    }
    setLoading(false)
  }

  if (loading) return <PageLoader />

  if (!invite) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-ink/60">This invite link is not valid.</p>
      </div>
    )
  }

  // Redirect to event page with invite context
  const searchParams = new URLSearchParams()
  if (inviterName) searchParams.set('invited_by', inviterName)

  return <Navigate to={`/events/${invite.event_id}?${searchParams.toString()}`} replace />
}
