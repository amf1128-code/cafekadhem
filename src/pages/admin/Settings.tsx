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
  const [contactEmail, setContactEmail] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME)

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    const { data } = await supabase.from('admin_settings').select('*').limit(1).single()
    if (data) {
      setSettings(data)
      setVenmoHandle(data.venmo_handle)
      setContactEmail(data.contact_email || '')
      setSiteUrl(data.site_url || '')
      setTheme(
        data.theme === 'theme2' ? 'theme2'
          : data.theme === 'theme3' ? 'theme3'
          : 'theme1',
      )
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
      contact_email: contactEmail.trim() || null,
      site_url: siteUrl.trim().replace(/\/$/, '') || 'https://cafekadhem.com',
      theme,
    }

    console.log('[Settings Save] Payload:', payload, 'existing settings row:', settings)

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
      console.error(
        '[Settings Save] Failed:',
        'message=', error.message,
        'details=', error.details,
        'hint=', error.hint,
        'code=', error.code,
        'full=', error,
      )
      addToast(`Failed to save settings: ${error.message || 'unknown error'}`, 'error')
    } else {
      console.log('[Settings Save] Success')
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
          label="Contact Email"
          type="email"
          value={contactEmail}
          onChange={e => setContactEmail(e.target.value)}
          placeholder="Optional"
        />
        <div>
          <Input
            label="Public Site URL"
            type="url"
            value={siteUrl}
            onChange={e => setSiteUrl(e.target.value)}
            placeholder="https://cafekadhem.com"
            required
          />
          <p className="text-xs text-ink-muted mt-1">
            The canonical domain used in outbound emails (ticket links, invites). No trailing slash.
          </p>
        </div>
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
