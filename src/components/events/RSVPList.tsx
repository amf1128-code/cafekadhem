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
    <div className="mb-6">
      <h2 className="font-serif text-xl text-forest-dark mb-3">Guest List</h2>

      {going.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-ink/60 mb-2">
            Going ({going.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {going.map(rsvp => (
              <GuestChip key={rsvp.id} guest={rsvp.guest} />
            ))}
          </div>
        </div>
      )}

      {maybe.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-ink/60 mb-2">
            Maybe ({maybe.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {maybe.map(rsvp => (
              <GuestChip key={rsvp.id} guest={rsvp.guest} />
            ))}
          </div>
        </div>
      )}

      {waitlisted.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-ink/60 mb-2">
            Waitlist ({waitlisted.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {waitlisted.map(rsvp => (
              <GuestChip key={rsvp.id} guest={rsvp.guest} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GuestChip({ guest }: { guest: PublicGuestProfile }) {
  return (
    <span className="inline-flex items-center gap-1 bg-white border border-warm rounded-full px-3 py-1 text-sm">
      <span className="text-ink">{guest.first_name}</span>
      {guest.instagram && (
        <a
          href={instagramUrl(guest.instagram)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-forest hover:text-forest-light text-xs"
        >
          @{guest.instagram}
        </a>
      )}
    </span>
  )
}
