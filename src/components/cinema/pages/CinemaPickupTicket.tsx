import { PickupTicket } from '../../../pages/PickupTicket'

/**
 * /pickup/:token — wraps the legacy PickupTicket page (order
 * summary + Venmo link + I've-paid button) inside the cinema chrome.
 * Internal styling stays for now; cinema-tokenize follow-up TODO.
 */
export function CinemaPickupTicket() {
  return <PickupTicket />
}
