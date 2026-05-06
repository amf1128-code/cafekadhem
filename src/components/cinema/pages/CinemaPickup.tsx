import { Pickup } from '../../../pages/Pickup'

/**
 * /cinema/pickup — wraps the legacy Pickup page (slot picker, cart,
 * Venmo deep link) inside the cinema chrome. Internal styling stays
 * for now; cinema-tokenize follow-up TODO.
 */
export function CinemaPickup() {
  return <Pickup />
}
