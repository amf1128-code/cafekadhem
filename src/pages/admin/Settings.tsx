import { useState, useEffect, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { AdminSettings as AdminSettingsType } from '../../lib/types'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'

export function AdminSettings() {
  const { addToast } = useToast()
  const [settings, setSettings] = useState<AdminSettingsType | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [venmoHandle, setVenmoHandle] = useState('')
  const [cafeName, setCafeName] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    const { data } = await supabase.from('admin_settings').select('*').limit(1).single()
    if (data) {
      setSettings(data)
      setVenmoHandle(data.venmo_handle)
      setCafeName(data.cafe_name)
      setContactEmail(data.contact_email || '')
    }
    setLoading(false)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!settings) return
    setSaving(true)

    const { error } = await supabase
      .from('admin_settings')
      .update({
        venmo_handle: venmoHandle.trim(),
        cafe_name: cafeName.trim(),
        contact_email: contactEmail.trim() || null,
      })
      .eq('id', settings.id)

    if (error) {
      addToast('Failed to save settings', 'error')
    } else {
      addToast('Settings saved')
    }
    setSaving(false)
  }

  if (loading) return <PageLoader />

  return (
    <div>
      <h1 className="font-serif text-2xl text-forest-dark mb-6">Settings</h1>

      <form onSubmit={handleSave} className="max-w-md space-y-4">
        <Input
          label="Venmo Handle"
          value={venmoHandle}
          onChange={e => setVenmoHandle(e.target.value)}
          required
        />
        <Input
          label="Cafe Name"
          value={cafeName}
          onChange={e => setCafeName(e.target.value)}
          required
        />
        <Input
          label="Contact Email"
          type="email"
          value={contactEmail}
          onChange={e => setContactEmail(e.target.value)}
          placeholder="Optional"
        />
        <Button type="submit" loading={saving}>Save Settings</Button>
      </form>
    </div>
  )
}
