import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { isValidPhone, normalizePhone } from '../../../lib/utils/phone'
import { getGuestToken } from '../../../lib/utils/guest-token'
import { useToast } from '../../ui/Toast'

/**
 * /find-tickets — magic-link lookup. Same behavior as the legacy
 * page; UI rewritten in cinema style.
 */
export function CinemaFindTickets() {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [contact, setContact] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  // Default off so the phone path is never accepted while admin_settings
  // is still loading.
  const [smsEnabled, setSmsEnabled] = useState(false)

  const alreadyKnown = !!getGuestToken()

  useEffect(() => {
    let cancelled = false
    supabase
      .from('admin_settings')
      .select('sms_enabled')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) setSmsEnabled(!!data.sms_enabled)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = contact.trim()
    if (!trimmed) return

    const isEmail = trimmed.includes('@')
    const isPhone = !isEmail && smsEnabled && isValidPhone(trimmed)
    if (!isEmail && !isPhone) {
      addToast(
        smsEnabled
          ? 'Enter a valid phone number or email'
          : 'Enter a valid email address',
        'error',
      )
      return
    }

    setSending(true)
    try {
      const body = isEmail
        ? { email: trimmed }
        : { phone: normalizePhone(trimmed) }
      const { error } = await supabase.functions.invoke('lookup-tickets', { body })
      if (error) throw error
      setSent(true)
    } catch {
      addToast('Something went wrong. Try again.', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="ck-page" style={{ borderBottom: 'none' }}>
      <div className="ck-narrow">
        <div className="ck-eyebrow">✦ Sign in</div>
        <div
          className="ck-section-head-row"
          style={{ marginTop: 6, alignItems: 'baseline' }}
        >
          <h1 className="ck-h1">FIND ME.</h1>
          <span
            style={{
              fontFamily: 'var(--ck-arabic-display)',
              fontSize: 'clamp(40px, 5vw, 60px)',
              direction: 'rtl',
              color: 'var(--ck-cobalt)',
              lineHeight: 0.9,
            }}
          >
            ابحث
          </span>
        </div>
        <p
          className="ck-italic"
          style={{ fontSize: 18, marginTop: 14, lineHeight: 1.4 }}
        >
          {smsEnabled
            ? "Type the phone or email you've used with us before."
            : "Type the email you've used with us before."}
          {' '}We&apos;ll send a one-tap link to your RSVPs, tickets, and pickup
          orders. No password.
        </p>

        {alreadyKnown && (
          <div
            style={{
              marginTop: 22,
              padding: '12px 16px',
              border: '2px solid var(--ck-ink)',
              background: 'var(--ck-paper)',
              fontFamily: 'var(--ck-mono)',
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>We recognize this device.</span>
            <button
              type="button"
              onClick={() => navigate('/my-tickets')}
              className="ck-btn ck-btn--ink"
            >
              Take me to my stuff →
            </button>
          </div>
        )}

        {sent ? (
          <div
            className="ck-card"
            style={{
              marginTop: 28,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 'clamp(48px, 6vw, 72px)',
                color: 'var(--ck-cobalt)',
                direction: 'rtl',
                lineHeight: 1,
              }}
            >
              تم
            </div>
            <h2 className="ck-h2" style={{ marginTop: 10 }}>
              CHECK YOUR MESSAGES.
            </h2>
            <p
              className="ck-italic"
              style={{ fontSize: 16, marginTop: 14, lineHeight: 1.5 }}
            >
              If we have a record of this contact, a one-tap link is on its
              way. Tap it from your phone or computer to see your RSVPs,
              tickets, and pickup orders in one place.
            </p>
            <p
              style={{
                fontFamily: 'var(--ck-mono)',
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                marginTop: 14,
                opacity: 0.7,
              }}
            >
              The link works for 24 hours. Check spam if you don&apos;t see it.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{
              marginTop: 28,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <label className="ck-label">
              {smsEnabled ? 'Phone or email' : 'Email'}
            </label>
            <input
              type={smsEnabled ? 'text' : 'email'}
              value={contact}
              onChange={e => setContact(e.target.value)}
              placeholder={
                smsEnabled
                  ? '(555) 555-5555 or you@example.com'
                  : 'you@example.com'
              }
              className="ck-input"
              autoFocus
            />
            <button
              type="submit"
              disabled={sending || !contact.trim()}
              className="ck-btn ck-btn--primary ck-btn--block"
              style={{ marginTop: 4 }}
            >
              {sending ? 'Sending…' : 'Send me the link →'}
            </button>
          </form>
        )}
      </div>
    </section>
  )
}
