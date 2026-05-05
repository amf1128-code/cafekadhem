import type { RSVP, PublicGuestProfile } from '../../lib/types'
import { instagramUrl } from '../../lib/utils/instagram'

type RSVPRow = RSVP & { guest: PublicGuestProfile }

interface RSVPListProps {
  rsvps: RSVPRow[]
}

export function RSVPList({ rsvps }: RSVPListProps) {
  const going = rsvps.filter(r => r.status === 'yes')
  const maybe = rsvps.filter(r => r.status === 'maybe')
  const waitlisted = rsvps.filter(r => r.status === 'waitlisted')

  if (going.length === 0 && maybe.length === 0 && waitlisted.length === 0) {
    return null
  }

  // Build a lookup so each +1 row can resolve its host's display name. The
  // map covers every visible status (yes / maybe / waitlisted) so a +1
  // whose host fell off the going list (e.g. host moved to maybe) still
  // resolves to a name rather than a blank annotation.
  const rsvpById = new Map<string, RSVPRow>()
  for (const r of rsvps) rsvpById.set(r.id, r)
  function hostNameFor(rsvp: RSVPRow): string | null {
    if (!rsvp.plus_one_of) return null
    return rsvpById.get(rsvp.plus_one_of)?.guest?.first_name ?? null
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
              <GuestName key={rsvp.id} rsvp={rsvp} hostName={hostNameFor(rsvp)} />
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
              <GuestName key={rsvp.id} rsvp={rsvp} hostName={hostNameFor(rsvp)} />
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
              <GuestName key={rsvp.id} rsvp={rsvp} hostName={hostNameFor(rsvp)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GuestName({ rsvp, hostName }: { rsvp: RSVPRow; hostName: string | null }) {
  const guest = rsvp.guest
  return (
    <span className="inline-flex items-center gap-1.5 font-serif text-ink">
      {guest.first_name}
      {hostName && (
        <span className="text-xs italic text-ink-muted">(+1 of {hostName})</span>
      )}
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
