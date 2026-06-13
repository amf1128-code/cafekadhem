/**
 * Cart math helpers. The pre-order cart (event detail, /events/:id/order,
 * and /pickup) all compute the same "sum of unit price × quantity" and
 * "sum of quantities" totals. Centralised here so the null-price guard
 * and the reduce live in one place.
 */

/** A cart line: a menu item carrying a (possibly null) unit price plus a quantity. */
export interface CartLine {
  menuItem: { price: number | null }
  quantity: number
}

/**
 * Total dollar value of a cart: Σ (unit price × quantity). A null or
 * undefined unit price is treated as 0.
 */
export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + (line.menuItem.price ?? 0) * line.quantity, 0)
}

/** Total number of items in a cart: Σ quantity. */
export function cartCount(lines: { quantity: number }[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0)
}
