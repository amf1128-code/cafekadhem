import { useState, useEffect, type FormEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Menu, MenuItem } from '../../lib/types'
import { Button } from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { sendNotification } from '../../lib/notifications'
import { THEMES, type ThemeId } from '../../lib/theme/themes'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function AdminEventForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const isEdit = !!id

  const [title, setTitle] = useState('')
  const [gatheringNumber, setGatheringNumber] = useState('')
  const [eventType, setEventType] = useState('')
  const [rsvpRequired, setRsvpRequired] = useState(true)
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [locationName, setLocationName] = useState('')
  const [location, setLocation] = useState('')
  const [capacity, setCapacity] = useState('')
  const [donationInfo, setDonationInfo] = useState('')
  const [menuId, setMenuId] = useState('')
  const [isPublished, setIsPublished] = useState(false)
  const [ticketingEnabled, setTicketingEnabled] = useState(false)
  const [ticketPrice, setTicketPrice] = useState('')
  const [flyerFile, setFlyerFile] = useState<File | null>(null)
  const [flyerUrl, setFlyerUrl] = useState<string | null>(null)
  const [homeFlyerFile, setHomeFlyerFile] = useState<File | null>(null)
  const [homeFlyerUrl, setHomeFlyerUrl] = useState<string | null>(null)
  const [theme, setTheme] = useState<ThemeId>('theme1')

  const [menus, setMenus] = useState<Menu[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Per-event quantity limits, keyed by menu_item_id. Empty string means
  // "no limit". Loaded from event_menu_item_limits and reconciled on save.
  const [menuItemsForLimits, setMenuItemsForLimits] = useState<MenuItem[]>([])
  const [limits, setLimits] = useState<Record<string, string>>({})

  useEffect(() => {
    loadData()
  }, [id])

  // Whenever the selected menu changes, load its items so we can render the
  // inline per-item limit inputs. Items without an explicit limit row are
  // shown with an empty input (no cap).
  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!menuId) {
        setMenuItemsForLimits([])
        return
      }
      const { data } = await supabase
        .from('menu_items')
        .select('*')
        .eq('menu_id', menuId)
        .order('sort_order')
      if (!cancelled && data) setMenuItemsForLimits(data)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [menuId])

  async function loadData() {
    const { data: menuData } = await supabase.from('menus').select('*').order('name')
    if (menuData) setMenus(menuData)

    if (id) {
      const { data: limitRows } = await supabase
        .from('event_menu_item_limits')
        .select('menu_item_id, max_quantity')
        .eq('event_id', id)
      if (limitRows) {
        const map: Record<string, string> = {}
        for (const row of limitRows) map[row.menu_item_id] = String(row.max_quantity)
        setLimits(map)
      }

      const { data: event } = await supabase.from('events').select('*').eq('id', id).single()
      if (event) {
        setTitle(event.title)
        setGatheringNumber(event.gathering_number || '')
        setEventType(event.event_type || '')
        setRsvpRequired(event.rsvp_required ?? true)
        setDescription(event.description || '')
        setDate(event.date)
        setStartTime(event.start_time)
        setEndTime(event.end_time || '')
        setLocation(event.location)
        setLocationName(event.location_name || '')
        setCapacity(event.capacity != null ? String(event.capacity) : '')
        setDonationInfo(event.donation_info || '')
        setMenuId(event.menu_id || '')
        setIsPublished(event.is_published)
        setTicketingEnabled(!!event.ticketing_enabled)
        setTicketPrice(event.ticket_price != null ? String(event.ticket_price) : '')
        setFlyerUrl(event.flyer_url)
        setHomeFlyerUrl(event.home_flyer_url)
        if (event.theme === 'theme1' || event.theme === 'theme2' || event.theme === 'theme3') {
          setTheme(event.theme)
        }
      }
    }

    setLoading(false)
  }

  async function uploadFlyer(file: File): Promise<string> {
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new Error('Only JPG, PNG, and WebP files are allowed')
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('File must be under 5MB')
    }

    const ext = file.name.split('.').pop()
    const path = `${Date.now()}.${ext}`

    const { error } = await supabase.storage.from('flyers').upload(path, file)
    if (error) {
      console.error('[Flyer Upload] Failed:', error.message, error)
      throw new Error(`Flyer upload failed: ${error.message}`)
    }

    const { data } = supabase.storage.from('flyers').getPublicUrl(path)
    return data.publicUrl
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !date || !startTime || !location.trim()) {
      addToast('Please fill in all required fields', 'error')
      return
    }

    setSaving(true)

    try {
      let uploadedFlyerUrl = flyerUrl
      if (flyerFile) {
        uploadedFlyerUrl = await uploadFlyer(flyerFile)
      }

      let uploadedHomeFlyerUrl = homeFlyerUrl
      if (homeFlyerFile) {
        uploadedHomeFlyerUrl = await uploadFlyer(homeFlyerFile)
      }

      const eventData = {
        title: title.trim(),
        gathering_number: gatheringNumber.trim() || null,
        event_type: eventType.trim() || null,
        rsvp_required: rsvpRequired,
        description: description.trim() || null,
        date,
        start_time: startTime,
        end_time: endTime || null,
        location: location.trim(),
        location_name: locationName.trim() || null,
        capacity: capacity ? parseInt(capacity) : null,
        donation_info: donationInfo.trim() || null,
        menu_id: menuId || null,
        is_published: isPublished,
        ticketing_enabled: ticketingEnabled,
        ticket_price: ticketingEnabled && ticketPrice ? parseFloat(ticketPrice) : null,
        flyer_url: uploadedFlyerUrl,
        home_flyer_url: uploadedHomeFlyerUrl,
        theme,
      }

      let savedEventId = id
      if (isEdit) {
        console.log('[Event Update] Saving event data:', eventData)
        const { error } = await supabase.from('events').update(eventData).eq('id', id!)
        if (error) {
          console.error('[Event Update] Failed:', error.message, error.details, error.hint, error)
          throw new Error(`Failed to update event: ${error.message}`)
        }
        addToast('Event updated')
      } else {
        console.log('[Event Create] Saving event data:', eventData)
        const { data: created, error } = await supabase
          .from('events')
          .insert(eventData)
          .select('id')
          .single()
        if (error) {
          console.error('[Event Create] Failed:', error.message, error.details, error.hint, error)
          throw new Error(`Failed to create event: ${error.message}`)
        }
        savedEventId = created?.id
        addToast('Event created')
      }

      if (savedEventId && menuId) {
        // Reconcile event_menu_item_limits: upsert non-empty rows, delete
        // any item whose input was cleared. Items with no row at all stay
        // uncapped.
        const upsertRows: { event_id: string; menu_item_id: string; max_quantity: number }[] = []
        const clearedItemIds: string[] = []
        for (const item of menuItemsForLimits) {
          const raw = (limits[item.id] || '').trim()
          if (raw === '') {
            clearedItemIds.push(item.id)
            continue
          }
          const parsed = parseInt(raw, 10)
          if (Number.isFinite(parsed) && parsed >= 0) {
            upsertRows.push({
              event_id: savedEventId,
              menu_item_id: item.id,
              max_quantity: parsed,
            })
          }
        }
        if (upsertRows.length > 0) {
          const { error: upErr } = await supabase
            .from('event_menu_item_limits')
            .upsert(upsertRows, { onConflict: 'event_id,menu_item_id' })
          if (upErr) console.error('[Event Limits] upsert failed:', upErr)
        }
        if (clearedItemIds.length > 0) {
          const { error: delErr } = await supabase
            .from('event_menu_item_limits')
            .delete()
            .eq('event_id', savedEventId)
            .in('menu_item_id', clearedItemIds)
          if (delErr) console.error('[Event Limits] delete failed:', delErr)
        }
      }

      navigate('/admin')
    } catch (err) {
      console.error('[Event Save] Error:', err)
      addToast(err instanceof Error ? err.message : 'Failed to save event', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleSendUpdate() {
    if (!id) return

    // Get all RSVPs for this event
    const { data: rsvps } = await supabase
      .from('rsvps')
      .select('guest_id')
      .eq('event_id', id)
      .in('status', ['yes', 'maybe'])

    if (!rsvps || rsvps.length === 0) {
      addToast('No guests to notify', 'info')
      return
    }

    for (const rsvp of rsvps) {
      sendNotification({
        guestId: rsvp.guest_id,
        eventId: id,
        type: 'event_update',
      })
    }

    addToast(`Sending updates to ${rsvps.length} guests`)
  }

  if (loading) return <PageLoader />

  return (
    <div>
      <h1 className="font-serif text-2xl text-forest-dark mb-6">
        {isEdit ? 'Edit Event' : 'Create Event'}
      </h1>

      <form onSubmit={handleSave} className="max-w-2xl space-y-4">
        <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} required />
        <Input
          label="Event Type"
          value={eventType}
          onChange={e => setEventType(e.target.value)}
          placeholder='e.g. "Watch Party", "Pop-Up", "Darty" (free-form, shown above the title)'
        />
        <Input label="Gathering Number" value={gatheringNumber} onChange={e => setGatheringNumber(e.target.value)} placeholder='e.g. "No. 01" (optional, shown on public page)' />
        <Textarea label="Description" value={description} onChange={e => setDescription(e.target.value)} />

        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
          <Input label="Start Time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="End Time" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
          <Input label="Capacity" type="number" min="1" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="Unlimited" />
        </div>

        <Input
          label="Location Name"
          value={locationName}
          onChange={e => setLocationName(e.target.value)}
          placeholder='e.g. "The Roastery" (optional)'
        />
        <Input
          label="Location Address"
          value={location}
          onChange={e => setLocation(e.target.value)}
          placeholder="123 Main St, Brooklyn, NY"
          required
        />
        <Textarea label="Donation Info" value={donationInfo} onChange={e => setDonationInfo(e.target.value)} placeholder="Where proceeds go (optional)" />

        <Select
          label="Menu"
          value={menuId}
          onChange={e => setMenuId(e.target.value)}
          options={menus.map(m => ({ value: m.id, label: m.name }))}
          placeholder="No menu"
        />

        {menuId && menuItemsForLimits.length > 0 && (
          <div className="border border-warm rounded-lg p-4 bg-warm/10">
            <p className="text-sm font-medium text-ink mb-1">Per-item limits (optional)</p>
            <p className="text-xs text-ink-muted mb-3">
              Cap how many of each item can be ordered for this event. Leave blank for no limit.
              Limits are scoped to this event — re-using the menu later starts fresh.
            </p>
            <div className="space-y-2">
              {menuItemsForLimits.map(item => (
                <div key={item.id} className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-ink">{item.name}</span>
                  <input
                    type="number"
                    min="0"
                    value={limits[item.id] || ''}
                    onChange={e =>
                      setLimits(prev => ({ ...prev, [item.id]: e.target.value }))
                    }
                    placeholder="No limit"
                    className="w-24 rounded-lg border border-warm bg-white px-3 py-2 text-sm text-ink focus:border-forest outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <Select
            label="Theme"
            value={theme}
            onChange={e => setTheme(e.target.value as ThemeId)}
            options={THEMES.map(t => ({ value: t.id, label: `${t.name} — ${t.tagline}` }))}
          />
          <p className="text-xs text-ink-muted mt-1">
            Visual treatment for this event's detail and ticket pages. Also drives the
            home page when Site Theme is set to Default and this is the next upcoming event.
          </p>
        </div>

        {/* Flyer Upload — full image shown on the event detail page */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Flyer</label>
          <p className="text-xs text-ink-muted mb-2">Shown in full on the event detail page.</p>
          {flyerUrl && !flyerFile && (
            <div className="mb-2">
              <img src={flyerUrl} alt="Current flyer" className="w-32 h-auto rounded border border-warm" />
            </div>
          )}
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-forest text-forest cursor-pointer hover:bg-forest hover:text-cream transition-colors duration-200 text-sm font-medium">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {flyerFile ? flyerFile.name : 'Choose Image'}
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              onChange={e => setFlyerFile(e.target.files?.[0] || null)}
              className="sr-only"
            />
          </label>
          <p className="text-xs text-ink/50 mt-1">JPG, PNG, or WebP. Max 5MB.</p>
        </div>

        {/* Home Page Image — optional alternate cropped for the home card */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Home Page Image <span className="text-ink-muted font-normal">(optional)</span></label>
          <p className="text-xs text-ink-muted mb-2">Shown on the home page card at the image's natural aspect ratio. Falls back to the flyer above if left empty.</p>
          {homeFlyerUrl && !homeFlyerFile && (
            <div className="mb-2">
              <img src={homeFlyerUrl} alt="Current home image" className="w-32 h-auto rounded border border-warm" />
            </div>
          )}
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-forest text-forest cursor-pointer hover:bg-forest hover:text-cream transition-colors duration-200 text-sm font-medium">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {homeFlyerFile ? homeFlyerFile.name : 'Choose Image'}
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              onChange={e => setHomeFlyerFile(e.target.files?.[0] || null)}
              className="sr-only"
            />
          </label>
          {homeFlyerUrl && !homeFlyerFile && (
            <button
              type="button"
              onClick={() => setHomeFlyerUrl(null)}
              className="ml-3 text-xs tracking-[0.15em] uppercase text-ink-muted hover:text-forest transition-colors"
            >
              Remove
            </button>
          )}
          <p className="text-xs text-ink/50 mt-1">JPG, PNG, or WebP. Max 5MB.</p>
        </div>

        {/* Ticketing */}
        <div className="border border-warm rounded-lg p-4 bg-warm/10">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={ticketingEnabled}
              onChange={e => setTicketingEnabled(e.target.checked)}
              className="rounded border-warm text-forest focus:ring-forest"
            />
            Require paid ticket for entry
          </label>
          <p className="text-xs text-ink-muted mt-1 ml-6">
            Guests RSVP, pay via Venmo, then you confirm payment in the tickets queue. Each confirmed guest gets a QR-code ticket sent via their notification preference.
          </p>
          {ticketingEnabled && (
            <div className="mt-3 ml-6">
              <Input
                label="Ticket Price (USD)"
                type="number"
                step="0.01"
                min="0"
                value={ticketPrice}
                onChange={e => setTicketPrice(e.target.value)}
                placeholder="e.g. 25"
              />
            </div>
          )}
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rsvpRequired}
              onChange={e => setRsvpRequired(e.target.checked)}
              className="rounded border-warm text-forest focus:ring-forest"
            />
            RSVP required for this event
          </label>
          <p className="text-xs text-ink-muted mt-1 ml-6">
            When checked, the home card reads "RSVP Required". Uncheck to soften it to "RSVP Requested".
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPublished}
            onChange={e => setIsPublished(e.target.checked)}
            className="rounded border-warm text-forest focus:ring-forest"
          />
          Published (visible to guests)
        </label>

        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={saving}>
            {isEdit ? 'Update Event' : 'Create Event'}
          </Button>
          {isEdit && (
            <Button type="button" variant="outline" onClick={handleSendUpdate}>
              Send Update to Guests
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => navigate('/admin')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
