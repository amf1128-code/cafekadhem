import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { Guest } from '../../lib/types'
import { formatPhone } from '../../lib/utils/phone'
import { instagramUrl } from '../../lib/utils/instagram'
import { downloadCSV } from '../../lib/utils/csv'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'

export function AdminGuestDirectory() {
  const { addToast } = useToast()
  const [guests, setGuests] = useState<(Guest & { event_count: number })[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [nukingId, setNukingId] = useState<string | null>(null)

  useEffect(() => {
    loadGuests()
  }, [])

  async function handleNuke(guest: Guest) {
    const label = `${guest.first_name}${guest.last_name ? ' ' + guest.last_name : ''}`
    if (!confirm(
      `Permanently delete ${label} and every RSVP, order, ticket, and notification tied to them?\n\nThis cannot be undone.`
    )) return

    setNukingId(guest.id)
    try {
      const { data, error } = await supabase.rpc('nuke_guest', { p_guest_id: guest.id })
      if (error) throw error
      if (!data?.guest_found) {
        addToast('Guest already gone', 'error')
      } else {
        const parts: string[] = []
        if (data.rsvps) parts.push(`${data.rsvps} RSVP${data.rsvps === 1 ? '' : 's'}`)
        if (data.orders) parts.push(`${data.orders} order${data.orders === 1 ? '' : 's'}`)
        if (data.pickup_orders) parts.push(`${data.pickup_orders} pickup`)
        if (data.notifications) parts.push(`${data.notifications} notif`)
        if (data.invites_sent) parts.push(`${data.invites_sent} invite${data.invites_sent === 1 ? '' : 's'}`)
        addToast(`Nuked ${label}${parts.length ? ' — ' + parts.join(', ') : ''}`)
      }
      setGuests(prev => prev.filter(g => g.id !== guest.id))
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete guest', 'error')
    } finally {
      setNukingId(null)
    }
  }

  async function loadGuests() {
    const { data } = await supabase
      .from('guests')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) {
      const withCounts = await Promise.all(
        data.map(async (guest) => {
          const { count } = await supabase
            .from('rsvps')
            .select('*', { count: 'exact', head: true })
            .eq('guest_id', guest.id)
            .eq('status', 'yes')
          return { ...guest, event_count: count || 0 }
        })
      )
      setGuests(withCounts)
    }
    setLoading(false)
  }

  function handleExport() {
    const rows = guests.map(g => ({
      first_name: g.first_name,
      last_name: g.last_name || '',
      email: g.email || '',
      phone: g.phone || '',
      instagram: g.instagram || '',
      notification_preference: g.notification_preference,
      events_attended: g.event_count,
    }))
    downloadCSV(rows, 'guests.csv')
    addToast('CSV downloaded')
  }

  const filtered = guests.filter(g => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      g.first_name.toLowerCase().includes(s) ||
      (g.last_name || '').toLowerCase().includes(s) ||
      (g.email || '').toLowerCase().includes(s) ||
      (g.phone || '').includes(s) ||
      (g.instagram || '').toLowerCase().includes(s)
    )
  })

  if (loading) return <PageLoader />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-2xl text-forest-dark">Guest Directory</h1>
        <Button variant="outline" onClick={handleExport}>Export CSV</Button>
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search guests..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <p className="text-sm text-ink/60 mb-3">{filtered.length} guests</p>

      <div className="bg-white border border-warm rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm bg-warm/30">
              <th className="text-left px-4 py-2 font-medium text-ink/70">Name</th>
              <th className="text-left px-4 py-2 font-medium text-ink/70">Email</th>
              <th className="text-left px-4 py-2 font-medium text-ink/70">Phone</th>
              <th className="text-left px-4 py-2 font-medium text-ink/70">Instagram</th>
              <th className="text-left px-4 py-2 font-medium text-ink/70">Pref</th>
              <th className="text-left px-4 py-2 font-medium text-ink/70">Events</th>
              <th className="text-right px-4 py-2 font-medium text-ink/70"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(guest => (
              <tr key={guest.id} className="border-b border-warm/50 last:border-0">
                <td className="px-4 py-3">
                  <span className="font-medium">{guest.first_name}</span>
                  {guest.last_name && <span className="text-ink/70"> {guest.last_name}</span>}
                </td>
                <td className="px-4 py-3 text-ink/70">{guest.email || '-'}</td>
                <td className="px-4 py-3 text-ink/70">
                  {guest.phone ? formatPhone(guest.phone) : '-'}
                </td>
                <td className="px-4 py-3">
                  {guest.instagram ? (
                    <a
                      href={instagramUrl(guest.instagram)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-forest hover:text-forest-light"
                    >
                      @{guest.instagram}
                    </a>
                  ) : '-'}
                </td>
                <td className="px-4 py-3 text-ink/60">{guest.notification_preference}</td>
                <td className="px-4 py-3 text-ink/60">{guest.event_count}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="danger"
                    size="sm"
                    loading={nukingId === guest.id}
                    disabled={nukingId !== null && nukingId !== guest.id}
                    onClick={() => handleNuke(guest)}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
