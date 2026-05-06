import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { setGuestToken } from '../../../lib/utils/guest-token'

/**
 * Cinema-styled /cinema/verify-merge?token=...
 *
 * Same logic as the legacy page: confirm the merge token, repoint
 * localStorage to the canonical guest_id, then send the visitor to
 * /cinema/my-tickets. USER_FLOWS_SPEC.md §3.4.
 */
type Phase = 'verifying' | 'success' | 'error'

export function CinemaVerifyMerge() {
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

      if (data?.ok || (data?.reason === 'already_consumed' && data?.guest_id)) {
        if (data.guest_id) setGuestToken(data.guest_id)
        setPhase('success')
        setTimeout(() => {
          if (!cancelled) navigate('/cinema/my-tickets', { replace: true })
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

  return (
    <section
      className="ck-page"
      style={{ textAlign: 'center', borderBottom: 'none' }}
    >
      <div className="ck-narrow">
        {phase === 'verifying' && (
          <>
            <div className="ck-eyebrow">✦ Confirming</div>
            <h1 className="ck-h1" style={{ marginTop: 12 }}>
              ONE
              <br />
              <span className="ck-italic">moment…</span>
            </h1>
          </>
        )}
        {phase === 'success' && (
          <>
            <div
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 'clamp(48px, 6vw, 80px)',
                color: 'var(--ck-cobalt)',
                direction: 'rtl',
                lineHeight: 1,
              }}
            >
              أهلاً
            </div>
            <h1 className="ck-h1" style={{ marginTop: 12 }}>
              ALL SET.
            </h1>
            <p
              style={{
                fontFamily: 'var(--ck-serif-edit)',
                fontStyle: 'italic',
                fontSize: 18,
                marginTop: 18,
              }}
            >
              Your accounts are combined. Taking you to your stuff…
            </p>
          </>
        )}
        {phase === 'error' && (
          <>
            <div className="ck-eyebrow">✦ Hmm</div>
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
                marginBottom: 28,
              }}
            >
              {reason === 'expired'
                ? 'This link has timed out. Pull up your stuff with the lookup form.'
                : reason === 'invalid_token'
                  ? "We don't recognize this link anymore."
                  : reason === 'missing_token'
                    ? 'No verification token in the URL.'
                    : "We couldn't confirm this link."}
            </p>
            <Link to="/cinema/find-tickets" className="ck-btn ck-btn--primary">
              Look up my tickets →
            </Link>
          </>
        )}
      </div>
    </section>
  )
}
