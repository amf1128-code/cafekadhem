import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { MessageTemplate } from '../../lib/types'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'

const TEMPLATE_LABELS: Record<string, string> = {
  payment_reminder: 'Payment reminder (unpaid + chase unconfirmed)',
  maybe_nudge: 'Maybe nudge',
}

// Admin-editable copy for the reminder / nudge sends (message_templates).
// Both the per-row buttons and the bulk blasts read these at send time.
export function AdminMessageTemplates() {
  const { addToast } = useToast()
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data } = await supabase.from('message_templates').select('*').order('key')
    if (data) setTemplates(data as MessageTemplate[])
    setLoading(false)
  }

  function update(key: string, field: 'subject' | 'email_body' | 'sms_body', value: string) {
    setTemplates(ts => ts.map(t => (t.key === key ? { ...t, [field]: value } : t)))
  }

  async function save(t: MessageTemplate) {
    setSavingKey(t.key)
    try {
      const { error } = await supabase
        .from('message_templates')
        .update({ subject: t.subject, email_body: t.email_body, sms_body: t.sms_body })
        .eq('key', t.key)
      if (error) throw error
      addToast('Saved')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save', 'error')
    } finally {
      setSavingKey(null)
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl text-forest-dark">Messages</h1>
        <p className="text-sm text-ink/60 mt-1">
          Copy for the reminder &amp; nudge sends. Placeholders:{' '}
          <code className="bg-warm/40 px-1 rounded">{'{name}'}</code>{' '}
          <code className="bg-warm/40 px-1 rounded">{'{event}'}</code>{' '}
          <code className="bg-warm/40 px-1 rounded">{'{amount}'}</code>. The event/pay link
          is appended automatically. (Bulk sends use a generic &ldquo;there&rdquo; for{' '}
          <code className="bg-warm/40 px-1 rounded">{'{name}'}</code>.)
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="bg-white border border-warm rounded-lg p-6 text-center text-ink/60">
          No templates found — apply migration 059.
        </div>
      ) : (
        templates.map(t => (
          <div key={t.key} className="bg-white border border-warm rounded-lg p-6 space-y-4">
            <h2 className="font-serif text-lg text-forest-dark">{TEMPLATE_LABELS[t.key] ?? t.key}</h2>
            <Input
              label="Subject"
              value={t.subject}
              onChange={e => update(t.key, 'subject', e.target.value)}
            />
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-ink/60 mb-2">
                Email body
              </label>
              <textarea
                value={t.email_body}
                onChange={e => update(t.key, 'email_body', e.target.value)}
                rows={4}
                className="w-full border border-warm rounded-lg bg-cream px-3 py-2 text-sm font-serif text-ink resize-y outline-none focus:border-forest"
              />
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-ink/60 mb-2">
                SMS body
              </label>
              <textarea
                value={t.sms_body}
                onChange={e => update(t.key, 'sms_body', e.target.value)}
                rows={3}
                className="w-full border border-warm rounded-lg bg-cream px-3 py-2 text-sm font-serif text-ink resize-y outline-none focus:border-forest"
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => save(t)} loading={savingKey === t.key}>
                Save
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
