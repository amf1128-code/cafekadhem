import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import type { Invite } from '../../../lib/types'
import { CinemaPageLoader } from '../primitives'

/**
 * Cinema-styled invite landing. Same flow as the legacy /invite/:token —
 * resolve the token, look up the inviter's first name, then redirect to
 * the event detail page (cinema variant) with the invitedBy context in
 * router state so the detail page can show "X invited you to this".
 */
export function CinemaInviteLanding() {
  const { token } = useParams<{ token: string }>()
  const [invite, setInvite] = useState<Invite | null>(null)
  const [inviterName, setInviterName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token) {
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('invites')
        .select('*')
        .eq('token', token)
        .single()
      if (cancelled) return
      if (data) {
        setInvite(data)
        if (data.invited_by) {
          const { data: guest } = await supabase
            .from('public_guest_profiles')
            .select('first_name')
            .eq('id', data.invited_by)
            .single()
          if (!cancelled && guest) setInviterName(guest.first_name)
        }
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  if (loading) return <CinemaPageLoader />

  if (!invite) {
    return (
      <section className="ck-page" style={{ textAlign: 'center' }}>
        <div className="ck-narrow">
          <div className="ck-eyebrow">✦ Invite check</div>
          <h1 className="ck-h1" style={{ marginTop: 12 }}>
            THIS LINK
            <br />
            <span className="ck-italic">expired</span>
          </h1>
          <p
            style={{
              fontFamily: 'var(--ck-serif-edit)',
              fontStyle: 'italic',
              fontSize: 18,
              marginTop: 18,
            }}
          >
            Ask whoever sent it to reshare, or head back to the calendar.
          </p>
        </div>
      </section>
    )
  }

  return (
    <Navigate
      to={`/cinema/events/${invite.event_id}`}
      state={inviterName ? { invitedBy: inviterName } : undefined}
      replace
    />
  )
}
