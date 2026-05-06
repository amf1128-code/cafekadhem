import { useState, useEffect, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { AdminSettings as AdminSettingsType } from '../../lib/types'
import { Button } from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { THEMES, type SiteThemeChoice } from '../../lib/theme/themes'

const SITE_THEME_OPTIONS: { value: SiteThemeChoice; label: string }[] = [
  { value: 'default', label: 'Default — follow next event' },
  ...THEMES.map(t => ({
    value: t.id as SiteThemeChoice,
    label: `${t.name} — ${t.tagline}`,
  })),
]

function isValidSiteTheme(value: unknown): value is SiteThemeChoice {
  return (
    value === 'default' ||
    value === 'theme1' ||
    value === 'theme2' ||
    value === 'theme3'
  )
}

export function AdminSettings() {
  const { addToast } = useToast()
  const [settings, setSettings] = useState<AdminSettingsType | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [venmoHandle, setVenmoHandle] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [theme, setTheme] = useState<SiteThemeChoice>('default')
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [currentMenuBlurb, setCurrentMenuBlurb] = useState('')

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
      setTheme(isValidSiteTheme(data.theme) ? data.theme : 'default')
      setSmsEnabled(!!data.sms_enabled)
      setCurrentMenuBlurb(data.current_menu_blurb || '')
    }
    setLoading(false)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)

    const payload = {
      venmo_handle: venmoHandle.trim(),
      contact_email: contactEmail.trim() || null,
      site_url: siteUrl.trim().replace(/\/$/, '') || 'https://cafekadhem.com',
      theme,
      sms_enabled: smsEnabled,
      current_menu_blurb: currentMenuBlurb.trim() || null,
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
            onChange={e => setTheme(e.target.value as SiteThemeChoice)}
            options={SITE_THEME_OPTIONS}
          />
          <p className="text-xs text-ink-muted mt-1">
            Controls the home page only. <strong>Default</strong> follows the
            next upcoming event's theme. The other options force the home page
            into that theme regardless of upcoming events. Each event's detail
            page always uses its own theme (set in the event editor).
          </p>
        </div>
        <div>
          <Textarea
            label='"Current Menu" blurb'
            value={currentMenuBlurb}
            onChange={e => setCurrentMenuBlurb(e.target.value)}
            placeholder="The menu rotates with the night. This one travels with the pop-up — small, snackable, easy to eat one-handed."
          />
          <p className="text-xs text-ink-muted mt-1">
            Italic line shown under "CURRENT MENU." on the cinema landing
            (/cinema). Leave blank for the default copy.
          </p>
        </div>
        <div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={smsEnabled}
              onChange={e => setSmsEnabled(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-medium text-ink">Enable SMS notifications</span>
              <span className="block text-xs text-ink-muted mt-1">
                While off, every public form hides the phone input and the SMS
                notification option, and lookup/invite flows accept email only.
                Turn this on once your 10DLC campaign is approved so the site
                does not send any SMS in the meantime.
              </span>
            </span>
          </label>
        </div>
        <Button type="submit" loading={saving}>Save Settings</Button>
      </form>
    </div>
  )
}
