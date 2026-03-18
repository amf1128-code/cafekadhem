import { useState, useEffect, type FormEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Menu } from '../../lib/types'
import { Button } from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { sendNotification } from '../../lib/notifications'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function AdminEventForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const isEdit = !!id

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [location, setLocation] = useState('')
  const [capacity, setCapacity] = useState('')
  const [donationInfo, setDonationInfo] = useState('')
  const [menuId, setMenuId] = useState('')
  const [isPublished, setIsPublished] = useState(false)
  const [flyerFile, setFlyerFile] = useState<File | null>(null)
  const [flyerUrl, setFlyerUrl] = useState<string | null>(null)

  const [menus, setMenus] = useState<Menu[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    const { data: menuData } = await supabase.from('menus').select('*').order('name')
    if (menuData) setMenus(menuData)

    if (id) {
      const { data: event } = await supabase.from('events').select('*').eq('id', id).single()
      if (event) {
        setTitle(event.title)
        setDescription(event.description || '')
        setDate(event.date)
        setStartTime(event.start_time)
        setEndTime(event.end_time || '')
        setLocation(event.location)
        setCapacity(event.capacity != null ? String(event.capacity) : '')
        setDonationInfo(event.donation_info || '')
        setMenuId(event.menu_id || '')
        setIsPublished(event.is_published)
        setFlyerUrl(event.flyer_url)
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
    if (error) throw error

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

      const eventData = {
        title: title.trim(),
        description: description.trim() || null,
        date,
        start_time: startTime,
        end_time: endTime || null,
        location: location.trim(),
        capacity: capacity ? parseInt(capacity) : null,
        donation_info: donationInfo.trim() || null,
        menu_id: menuId || null,
        is_published: isPublished,
        flyer_url: uploadedFlyerUrl,
      }

      if (isEdit) {
        const { error } = await supabase.from('events').update(eventData).eq('id', id!)
        if (error) throw error
        addToast('Event updated')
      } else {
        const { error } = await supabase.from('events').insert(eventData)
        if (error) throw error
        addToast('Event created')
      }

      navigate('/admin')
    } catch (err) {
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
        <Textarea label="Description" value={description} onChange={e => setDescription(e.target.value)} />

        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
          <Input label="Start Time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="End Time" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
          <Input label="Capacity" type="number" min="1" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="Unlimited" />
        </div>

        <Input label="Location" value={location} onChange={e => setLocation(e.target.value)} required />
        <Textarea label="Donation Info" value={donationInfo} onChange={e => setDonationInfo(e.target.value)} placeholder="Where proceeds go (optional)" />

        <Select
          label="Menu"
          value={menuId}
          onChange={e => setMenuId(e.target.value)}
          options={menus.map(m => ({ value: m.id, label: m.name }))}
          placeholder="No menu"
        />

        {/* Flyer Upload */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Flyer</label>
          {flyerUrl && !flyerFile && (
            <div className="mb-2">
              <img src={flyerUrl} alt="Current flyer" className="w-32 h-auto rounded border border-warm" />
            </div>
          )}
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            onChange={e => setFlyerFile(e.target.files?.[0] || null)}
            className="text-sm text-ink/70"
          />
          <p className="text-xs text-ink/50 mt-1">JPG, PNG, or WebP. Max 5MB.</p>
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
