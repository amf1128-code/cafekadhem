/**
 * /verify-merge?token=...
 *
 * Lands here when a guest taps the verification link sent during a
 * Case B identity collision (USER_FLOWS_SPEC.md §3.4). Confirms the
 * token, runs merge_guests server-side, then sends the guest to
 * /my-tickets with localStorage repointed at the canonical guest_id.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { setGuestToken } from '../lib/utils/guest-token'

type Phase = 'verifying' | 'success' | 'error'

export function VerifyMerge() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('verifying')
  const [reason, setReason] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setPhase('error')
      setReason('missing_token')
      return
    }

    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc('confirm_merge_verification', {
        p_token: token,
      })
      if (cancelled) return

      if (error) {
        setPhase('error')
        setReason(error.message)
        return
      }

      // already_consumed is a soft success — the merge already happened,
      // we just need to reset localStorage to the kept id.
      if (data?.ok || (data?.reason === 'already_consumed' && data?.guest_id)) {
        if (data.guest_id) setGuestToken(data.guest_id)
        setPhase('success')
        // Brief pause so the user sees the success state before redirect.
        setTimeout(() => {
          if (!cancelled) navigate('/my-tickets', { replace: true })
        }, 800)
        return
      }

      setPhase('error')
      setReason(data?.reason ?? 'unknown')
    })()

    return () => {
      cancelled = true
    }
  }, [token, navigate])

  if (phase === 'verifying') {
    return (
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <p className="text-sm opacity-70">Confirming…</p>
      </div>
    )
  }

  if (phase === 'success') {
    return (
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-serif italic mb-2">All set</h1>
        <p className="text-sm opacity-70">
          Your accounts are combined. Taking you to your stuff…
        </p>
      </div>
    )
  }

  // phase === 'error'
  const message =
    reason === 'expired'
      ? 'This link has expired. Please try again from your event page.'
      : reason === 'invalid_token'
        ? 'This link is no longer valid.'
        : reason === 'missing_token'
          ? 'No verification token in the URL.'
          : 'We couldn’t confirm this link.'

  return (
    <div className="max-w-md mx-auto px-6 py-16 text-center">
      <h1 className="text-2xl font-serif italic mb-2">Hmm</h1>
      <p className="text-sm opacity-70 mb-6">{message}</p>
      <Link to="/find-tickets" className="underline text-sm">
        Look up your stuff
      </Link>
    </div>
  )
}
