import { useState, useEffect, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { AdminSettings as AdminSettingsType } from '../../lib/types'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { useTheme } from '../../lib/theme/themes'
import { THEMES, DEFAULT_THEME, type ThemeId } from '../../lib/theme/themes'

export function AdminSettings() {
  const { addToast } = useToast()
  const { applyTheme } = useTheme()
  const [settings, setSettings] = useState<AdminSettingsType | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [venmoHandle, setVenmoHandle] = useState('')
  const [cafeName, setCafeName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME)

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
      setTheme(data.theme === 'theme2' ? 'theme2' : 'theme1')
    }
    setLoading(false)
  }

  function handleThemeChange(next: ThemeId) {
    setTheme(next)
    applyTheme(next) // live preview for the admin while editing
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)

    const payload = {
      venmo_handle: venmoHandle.trim(),
      cafe_name: cafeName.trim(),
      contact_email: contactEmail.trim() || null,
      theme,
    }

    let error
    if (settings) {
      ;({ error } = await supabase
        .from('admin_settings')
        .update(payload)
        .eq('id', settings.id))
    } else {
      const result = await supabase
        .from('admin_settings')
        .insert(payload)
        .select('*')
        .single()
      error = result.error
      if (result.data) setSettings(result.data)
    }

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
        <div>
          <Select
            label="Site Theme"
            value={theme}
            onChange={e => handleThemeChange(e.target.value as ThemeId)}
            options={THEMES.map(t => ({ value: t.id, label: `${t.name} — ${t.tagline}` }))}
          />
          <p className="text-xs text-ink-muted mt-1">
            Applies to all visitors. Changes preview here immediately; click Save to publish.
          </p>
        </div>
        <Button type="submit" loading={saving}>Save Settings</Button>
      </form>
    </div>
  )
}
