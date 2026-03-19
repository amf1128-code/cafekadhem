import type { RSVP, PublicGuestProfile } from '../../lib/types'
import { instagramUrl } from '../../lib/utils/instagram'

interface RSVPListProps {
  rsvps: (RSVP & { guest: PublicGuestProfile })[]
}

export function RSVPList({ rsvps }: RSVPListProps) {
  const going = rsvps.filter(r => r.status === 'yes')
  const maybe = rsvps.filter(r => r.status === 'maybe')
  const waitlisted = rsvps.filter(r => r.status === 'waitlisted')

  if (going.length === 0 && maybe.length === 0 && waitlisted.length === 0) {
    return null
  }

  return (
    <div className="space-y-6">
      {going.length > 0 && (
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-3">
            Going ({going.length})
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {going.map(rsvp => (
              <GuestName key={rsvp.id} guest={rsvp.guest} />
            ))}
          </div>
        </div>
      )}

      {maybe.length > 0 && (
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-3">
            Maybe ({maybe.length})
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {maybe.map(rsvp => (
              <GuestName key={rsvp.id} guest={rsvp.guest} />
            ))}
          </div>
        </div>
      )}

      {waitlisted.length > 0 && (
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-3">
            Waitlist ({waitlisted.length})
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {waitlisted.map(rsvp => (
              <GuestName key={rsvp.id} guest={rsvp.guest} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GuestName({ guest }: { guest: PublicGuestProfile }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-serif text-ink">
      {guest.first_name}
      {guest.instagram && (
        <a
          href={instagramUrl(guest.instagram)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-ink-muted hover:text-accent transition-colors"
        >
          @{guest.instagram}
        </a>
      )}
    </span>
  )
}
