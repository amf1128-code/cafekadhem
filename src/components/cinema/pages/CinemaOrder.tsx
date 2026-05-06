import { Order } from '../../../pages/Order'

/**
 * /events/:id/order — wraps the legacy Order page (cart, Venmo
 * deep link, confirmation) inside the cinema chrome (CinemaShell). The
 * Order component's internal Tailwind styling stays for now; cinema-
 * tokenize follow-up TODO.
 *
 * Functional behavior is identical to the production /events/:id/order
 * route — same RPCs, same Venmo handle, same notification fan-out.
 */
export function CinemaOrder() {
  return <Order />
}
