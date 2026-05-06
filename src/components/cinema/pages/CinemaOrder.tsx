import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CinemaPageLoader } from '../primitives'

/**
 * /cinema/events/:id/order — pre-order flow.
 *
 * STUB: redirects to the legacy order page for now, so the cart + Venmo
 * deep-link flow keeps working. The cinema-styled rebuild lands next.
 */
export function CinemaOrder() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  useEffect(() => {
    if (id) navigate(`/events/${id}/order`, { replace: true })
  }, [id, navigate])
  return <CinemaPageLoader />
}
