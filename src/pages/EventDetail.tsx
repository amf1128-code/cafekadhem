import { useState, useEffect } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Event, Menu, MenuItem, RSVP, PublicGuestProfile } from '../lib/types'
import { formatEventDateTime } from '../lib/utils/date'
import { getGuestToken } from '../lib/utils/guest-token'
import { PageLoader } from '../components/ui/LoadingSpinner'
import { Button } from '../components/ui/Button'
import { RSVPForm } from '../components/events/RSVPForm'
import { RSVPList } from '../components/events/RSVPList'
import { MenuDisplay } from '../components/menus/MenuDisplay'
import { ShareButton } from '../components/events/ShareButton'
import { InviteForm } from '../components/guests/InviteForm'

export function EventDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const invitedBy = searchParams.get('invited_by')
  const [event, setEvent] = useState<Event | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [rsvps, setRsvps] = useState<(RSVP & { guest: PublicGuestProfile })[]>([])
  const [myRsvp, setMyRsvp] = useState<RSVP | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) loadEvent()
  }, [id])

  async function loadEvent() {
    setLoading(true)

    const { data: eventData } = await supabase
      .from('events')
      .select('*')
      .eq('id', id!)
      .single()

    if (!eventData) {
      setLoading(false)
      return
    }

    setEvent(eventData)

    // Load menu if linked
    if (eventData.menu_id) {
      const [menuResult, itemsResult] = await Promise.all([
        supabase.from('menus').select('*').eq('id', eventData.menu_id).single(),
        supabase.from('menu_items').select('*').eq('menu_id', eventData.menu_id).order('sort_order'),
      ])
      if (menuResult.data) setMenu(menuResult.data)
      if (itemsResult.data) setMenuItems(itemsResult.data)
    }

    // Load RSVPs with public guest profiles
    const { data: rsvpData } = await supabase
      .from('rsvps')
      .select('*, guest:public_guest_profiles(*)')
      .eq('event_id', id!)
      .in('status', ['yes', 'maybe'])

    if (rsvpData) setRsvps(rsvpData as (RSVP & { guest: PublicGuestProfile })[])

    // Check for existing RSVP
    const guestToken = getGuestToken()
    if (guestToken) {
      const { data: myRsvpData } = await supabase
        .from('rsvps')
        .select('*')
        .eq('event_id', id!)
        .eq('guest_id', guestToken)
        .single()

      if (myRsvpData) setMyRsvp(myRsvpData)
    }

    setLoading(false)
  }

  if (loading) return <PageLoader />
  if (!event) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-ink/60">Event not found.</p>
      </div>
    )
  }

  const yesCount = rsvps.filter(r => r.status === 'yes').length
  const isFull = event.capacity ? yesCount >= event.capacity : false

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Flyer */}
      {event.flyer_url && (
        <div className="rounded-xl overflow-hidden mb-6">
          <img src={event.flyer_url} alt={event.title} className="w-full" />
        </div>
      )}

      {/* Invite Banner */}
      {invitedBy && (
        <div className="bg-forest/10 border border-forest/20 rounded-lg p-3 mb-4 text-center">
          <p className="text-forest text-sm font-medium">
            You've been invited by {invitedBy}!
          </p>
        </div>
      )}

      {/* Event Info */}
      <h1 className="font-serif text-3xl text-forest-dark mb-2">{event.title}</h1>
      <p className="text-ink/70 mb-1">{formatEventDateTime(event.date, event.start_time, event.end_time)}</p>
      <p className="text-ink/60 mb-4">{event.location}</p>

      {event.description && (
        <p className="text-ink/80 mb-6 whitespace-pre-line">{event.description}</p>
      )}

      {/* Donation Info */}
      {event.donation_info && (
        <div className="bg-white border border-warm rounded-lg p-4 mb-6">
          <h3 className="font-serif text-lg text-forest-dark mb-1">Where proceeds go</h3>
          <p className="text-ink/70 text-sm">{event.donation_info}</p>
        </div>
      )}

      {/* Capacity */}
      {event.capacity && (
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-warm/50 rounded-full h-2.5">
              <div
                className="bg-forest rounded-full h-2.5 transition-all"
                style={{ width: `${Math.min((yesCount / event.capacity) * 100, 100)}%` }}
              />
            </div>
            <span className="text-sm text-ink/60 whitespace-nowrap">
              {isFull ? 'Full' : `${yesCount} / ${event.capacity} spots`}
            </span>
          </div>
        </div>
      )}

      {/* RSVP Section */}
      <div className="bg-white border border-warm rounded-xl p-5 mb-6">
        <h2 className="font-serif text-xl text-forest-dark mb-4">RSVP</h2>
        <RSVPForm
          eventId={event.id}
          existingRsvp={myRsvp}
          isFull={isFull}
          onRsvpComplete={() => loadEvent()}
        />
      </div>

      {/* RSVP List */}
      <RSVPList rsvps={rsvps} />

      {/* Share & Invite */}
      <div className="bg-white border border-warm rounded-xl p-5 my-6 space-y-4">
        <h2 className="font-serif text-xl text-forest-dark">Share</h2>
        <ShareButton eventId={event.id} eventTitle={event.title} />
        <div className="border-t border-warm pt-4">
          <p className="text-sm text-ink/60 mb-2">Invite a friend directly:</p>
          <InviteForm eventId={event.id} />
        </div>
      </div>

      {/* Menu */}
      {menu && menuItems.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-2xl text-forest-dark">Menu</h2>
            {menuItems.some(item => item.price) && (
              <Link to={`/events/${event.id}/order`}>
                <Button>Pre-Order</Button>
              </Link>
            )}
          </div>
          <MenuDisplay items={menuItems} />
          {menuItems.some(item => item.price) && (
            <div className="mt-4 text-center">
              <Link to={`/events/${event.id}/order`}>
                <Button size="lg" className="w-full md:w-auto">Pre-Order from This Menu</Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
