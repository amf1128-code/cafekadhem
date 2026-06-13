/**
 * Money formatting helpers. The app deals in plain USD dollar amounts
 * stored as numbers (e.g. 12 → "$12.00"). Centralised here so the "$"
 * prefix and 2-decimal convention live in one place rather than being
 * re-derived with inline `.toFixed(2)` at every call site.
 */

/**
 * Format an amount as a USD display string, e.g. 12 → "$12.00". For
 * on-screen display where the currency symbol is shown.
 */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/**
 * Format a raw 2-decimal amount WITHOUT a currency symbol, e.g.
 * 12 → "12.00", null → "0.00". Used for Venmo deep-link amount params
 * and CSV export columns where a bare numeric string is required.
 */
export function formatAmount(amount: number | null | undefined): string {
  return (amount ?? 0).toFixed(2)
}
