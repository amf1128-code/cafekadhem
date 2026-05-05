import type { RSVP, PublicGuestProfile } from '../../lib/types'
import { instagramUrl } from '../../lib/utils/instagram'

type RSVPRow = RSVP & { guest: PublicGuestProfile }

interface RSVPListProps {
  rsvps: RSVPRow[]
}

export function RSVPList({ rsvps }: RSVPListProps) {
  // Section counts include +1 rows so the totals here match the home
  // card / event-summary seat math (capacity is consumed per row).
  const goingCount = rsvps.filter(r => r.status === 'yes').length
  const maybeCount = rsvps.filter(r => r.status === 'maybe').length
  const waitlistedCount = rsvps.filter(r => r.status === 'waitlisted').length

  if (goingCount === 0 && maybeCount === 0 && waitlistedCount === 0) {
    return null
  }

  // The rendered name list shows hosts only; a +1 surfaces as a badge on
  // the host's row rather than as its own entry. This avoids the host's
  // name appearing twice (once for them, once via the +1's annotation).
  const goingHosts = rsvps.filter(r => r.status === 'yes' && !r.plus_one_of)
  const maybeHosts = rsvps.filter(r => r.status === 'maybe' && !r.plus_one_of)
  const waitlistedHosts = rsvps.filter(r => r.status === 'waitlisted' && !r.plus_one_of)

  // host_rsvp_id -> true when that host has an attached +1.
  const hostHasPlusOne = new Set<string>()
  for (const r of rsvps) {
    if (r.plus_one_of) hostHasPlusOne.add(r.plus_one_of)
  }

  return (
    <div className="space-y-6">
      {goingCount > 0 && (
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-3">
            Going ({goingCount})
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {goingHosts.map(rsvp => (
              <GuestName key={rsvp.id} rsvp={rsvp} hasPlusOne={hostHasPlusOne.has(rsvp.id)} />
            ))}
          </div>
        </div>
      )}

      {maybeCount > 0 && (
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-3">
            Maybe ({maybeCount})
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {maybeHosts.map(rsvp => (
              <GuestName key={rsvp.id} rsvp={rsvp} hasPlusOne={hostHasPlusOne.has(rsvp.id)} />
            ))}
          </div>
        </div>
      )}

      {waitlistedCount > 0 && (
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-3">
            Waitlist ({waitlistedCount})
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {waitlistedHosts.map(rsvp => (
              <GuestName key={rsvp.id} rsvp={rsvp} hasPlusOne={hostHasPlusOne.has(rsvp.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GuestName({ rsvp, hasPlusOne }: { rsvp: RSVPRow; hasPlusOne: boolean }) {
  const guest = rsvp.guest
  return (
    <span className="inline-flex items-center gap-1.5 font-serif text-ink">
      {guest.first_name}
      {hasPlusOne && (
        <span className="text-xs text-ink-muted tracking-wide">+1</span>
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
