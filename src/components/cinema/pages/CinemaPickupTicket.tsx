import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CinemaPageLoader } from '../primitives'

/**
 * /cinema/pickup/:token — pickup ticket display.
 *
 * STUB: redirects to the legacy /pickup/:token page. Cinema rebuild
 * lands next.
 */
export function CinemaPickupTicket() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  useEffect(() => {
    if (token) navigate(`/pickup/${token}`, { replace: true })
  }, [token, navigate])
  return <CinemaPageLoader />
}
