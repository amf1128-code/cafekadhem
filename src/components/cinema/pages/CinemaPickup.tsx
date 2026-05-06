import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CinemaPageLoader } from '../primitives'

/**
 * /cinema/pickup — pickup ordering flow.
 *
 * STUB: redirects to the legacy /pickup page so the existing flow keeps
 * working while the cinema rebuild lands. The cinema chrome still wraps
 * the page since /cinema/pickup is a child of CinemaShell.
 */
export function CinemaPickup() {
  const navigate = useNavigate()
  useEffect(() => {
    navigate('/pickup', { replace: true })
  }, [navigate])
  return <CinemaPageLoader />
}
