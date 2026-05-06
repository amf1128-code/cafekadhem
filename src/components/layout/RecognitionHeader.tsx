import { Link } from 'react-router-dom'
import { clearMyGuest, useMyGuest } from '../../lib/identity/useMyGuest'

/**
 * Renders "Hi, X · not you?" when a guest is recognized, or
 * "I've been here before" link when anon. Mounted in PublicLayout's
 * Header. USER_FLOWS_SPEC.md §3a.4.
 */
export function RecognitionHeader() {
  const { guest, loading } = useMyGuest()

  if (loading) return null

  if (!guest?.first_name) {
    return (
      <Link
        to="/find-tickets"
        className="text-[11px] tracking-[0.18em] uppercase text-ink-muted hover:text-ink transition-colors"
      >
        I&apos;ve been here before
      </Link>
    )
  }

  return (
    <span className="text-[11px] tracking-[0.18em] uppercase text-ink-muted">
      <span className="text-ink">{guest.first_name}</span>
      <span className="mx-2 opacity-60">·</span>
      <button
        type="button"
        onClick={() => {
          if (confirm('Forget this device? You can sign back in from the next page.')) {
            clearMyGuest()
          }
        }}
        className="underline hover:text-ink transition-colors"
      >
        not you?
      </button>
    </span>
  )
}
