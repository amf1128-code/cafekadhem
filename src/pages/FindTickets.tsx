import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { normalizePhone, isValidPhone } from '../lib/utils/phone'
import { getGuestToken } from '../lib/utils/guest-token'
import { useToast } from '../components/ui/Toast'

export function FindTickets() {
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
          ? 'Enter a valid email or phone number'
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
    <div className="max-w-xl mx-auto px-6 py-12">
      <div className="border border-warm bg-parchment-light p-6 md:p-10">
        <p className="text-xs tracking-[0.25em] uppercase text-ink-muted mb-2 text-center">
          Cafe Kadhem
        </p>
        <h1 className="font-serif text-2xl md:text-3xl text-forest-dark italic text-center mb-6">
          Find my tickets
        </h1>

        {alreadyKnown && (
          <div className="mb-6 text-center">
            <button
              type="button"
              onClick={() => navigate('/my-tickets')}
              className="text-sm text-forest underline hover:text-forest-dark"
            >
              We recognize this device — go to my tickets
            </button>
          </div>
        )}

        {sent ? (
          <div className="text-center py-6">
            <p className="font-serif text-lg text-ink mb-3 italic">Check your messages.</p>
            <p className="text-sm text-ink-muted">
              If we have a record of this contact, a link to your RSVPs and tickets is on its way.
              The link expires in 24 hours.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-sm text-ink-muted text-center">
              {smsEnabled
                ? "Enter the email or phone you used when you RSVP'd. If you used both, just one is enough — we'll send the link there."
                : "Enter the email you used when you RSVP'd, and we'll send the link there."}
            </p>
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-2">
                {smsEnabled ? 'Email or phone' : 'Email'}
              </label>
              <input
                type={smsEnabled ? 'text' : 'email'}
                value={contact}
                onChange={e => setContact(e.target.value)}
                placeholder={smsEnabled ? 'you@example.com or (555) 555-5555' : 'you@example.com'}
                className="w-full border-0 border-b border-warm bg-transparent py-2 font-script text-lg text-ink italic placeholder:text-stone-dark placeholder:italic outline-none focus:border-ink transition-colors"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={sending || !contact.trim()}
              className="w-full border border-warm px-5 py-3 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors disabled:opacity-50"
            >
              {sending ? '...' : '[ Send me the link ]'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
