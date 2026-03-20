import { useState, useEffect } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Event, Menu, MenuItem, RSVP, PublicGuestProfile } from '../lib/types'
import { formatDate, formatTime } from '../lib/utils/date'
import { getGuestToken } from '../lib/utils/guest-token'
import { PageLoader } from '../components/ui/LoadingSpinner'
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
      .in('status', ['yes', 'maybe', 'waitlisted'])

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
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="font-serif text-xl text-ink-muted italic">Event not found.</p>
      </div>
    )
  }

  const yesCount = rsvps.filter(r => r.status === 'yes').length
  const waitlistCount = rsvps.filter(r => r.status === 'waitlisted').length
  const isFull = event.capacity ? yesCount >= event.capacity : false

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Main archival card */}
      <div className="relative border border-warm bg-parchment-light p-6 md:p-10 mb-8">
        {/* Vertical reference text — uses gathering_number from DB */}
        {event.gathering_number && (
          <div className="absolute top-6 right-3 vertical-text text-[10px] tracking-[0.15em] uppercase text-stone-dark hidden md:block">
            Gathering {event.gathering_number} // {event.location.split(',')[0]?.toUpperCase()}
          </div>
        )}

        {/* Header */}
        <p className="text-xs tracking-[0.25em] uppercase text-ink-muted mb-2">
          Cafe Kadhem
        </p>
        <h1 className="font-serif text-3xl md:text-4xl text-forest-dark italic mb-6 pr-8">
          {event.title}
        </h1>

        {/* Thin divider */}
        <div className="border-t border-warm mb-6" />

        {/* Info grid */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1">Date</p>
            <p className="font-serif text-lg text-ink">{formatDate(event.date)}</p>
          </div>
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1">Time</p>
            <p className="font-serif text-lg text-ink">{formatTime(event.start_time)}{event.end_time ? ` \u2013 ${formatTime(event.end_time)}` : ''}</p>
          </div>
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1">Seats</p>
            <p className="font-serif text-lg text-ink">{event.capacity || 'Open'}</p>
          </div>
        </div>

        {/* Thin divider */}
        <div className="border-t border-warm mb-6" />

        {/* Description */}
        {event.description && (
          <p className="font-serif text-lg text-ink-muted italic leading-relaxed mb-6 whitespace-pre-line">
            {event.description}
          </p>
        )}

        {/* Invite Banner */}
        {invitedBy && (
          <div className="border border-warm rounded px-4 py-3 mb-6 text-center">
            <p className="font-serif text-ink italic">
              You've been invited by <span className="text-ink font-medium not-italic">{invitedBy}</span>
            </p>
          </div>
        )}

        {/* Flyer image */}
        {event.flyer_url && (
          <div className="relative mb-8 flex justify-center">
            <div className="border-4 border-white shadow-sm w-full">
              <img
                src={event.flyer_url}
                alt={event.title}
                className="w-full aspect-[3/4] object-cover"
              />
            </div>
          </div>
        )}

        {/* Capacity bar */}
        {event.capacity && (
          <div className="mb-6">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-[10px] tracking-[0.2em] uppercase text-ink-muted">
                {isFull
                  ? `Full${waitlistCount > 0 ? ` \u2014 ${waitlistCount} on waitlist` : ''}`
                  : `${yesCount} / ${event.capacity} seats reserved`}
              </span>
            </div>
            <div className="h-px bg-stone relative">
              <div
                className="absolute top-0 left-0 h-px bg-ink transition-all"
                style={{ width: `${Math.min((yesCount / event.capacity) * 100, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* RSVP Section */}
      <div className="border border-warm bg-parchment-light p-6 md:p-10 mb-8">
        <RSVPForm
          eventId={event.id}
          existingRsvp={myRsvp}
          isFull={isFull}
          onRsvpComplete={() => loadEvent()}
        />
      </div>

      {/* Accordion sections */}
      <div className="border border-warm bg-parchment-light divide-y divide-stone">
        {/* Location */}
        <details open className="group">
          <summary className="px-6 md:px-10 py-5 text-xs tracking-[0.2em] uppercase text-ink-light font-medium">
            Location
          </summary>
          <div className="px-6 md:px-10 pb-6">
            <p className="font-serif text-2xl text-ink italic mb-1">{event.location}</p>
            {event.donation_info && (
              <div className="mt-4">
                <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-1">Where Proceeds Go</p>
                <p className="font-serif text-ink-light italic">{event.donation_info}</p>
              </div>
            )}
          </div>
        </details>

        {/* Guest List */}
        {rsvps.length > 0 && (
          <details className="group">
            <summary className="px-6 md:px-10 py-5 text-xs tracking-[0.2em] uppercase text-ink-light font-medium">
              Who's At The Table ({rsvps.filter(r => r.status === 'yes').length})
            </summary>
            <div className="px-6 md:px-10 pb-6">
              <RSVPList rsvps={rsvps} />
            </div>
          </details>
        )}

        {/* Menu */}
        {menu && menuItems.length > 0 && (
          <details className="group">
            <summary className="px-6 md:px-10 py-5 text-xs tracking-[0.2em] uppercase text-ink-light font-medium">
              The Menu
            </summary>
            <div className="px-6 md:px-10 pb-6">
              <MenuDisplay items={menuItems} />
              {menuItems.some(item => item.price) && (
                <div className="mt-6">
                  <Link
                    to={`/events/${event.id}/order`}
                    className="inline-block border border-warm px-8 py-3 text-xs tracking-[0.2em] uppercase text-ink-light hover:border-ink hover:text-ink transition-colors"
                  >
                    [ Pre-Order ]
                  </Link>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Share & Invite */}
        <details className="group">
          <summary className="px-6 md:px-10 py-5 text-xs tracking-[0.2em] uppercase text-ink-light font-medium">
            Invite A Friend
          </summary>
          <div className="px-6 md:px-10 pb-6 space-y-4">
            <ShareButton eventId={event.id} eventTitle={event.title} />
            <div className="border-t border-warm pt-4">
              <p className="text-xs tracking-[0.15em] uppercase text-ink-muted mb-3">Send a direct invite</p>
              <InviteForm eventId={event.id} />
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}
