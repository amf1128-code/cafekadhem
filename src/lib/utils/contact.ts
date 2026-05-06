/**
 * Canonical contact-field normalization.
 * USER_FLOWS_SPEC.md §3.1.
 *
 * `normalizePhone` lives in ./phone (alongside formatPhone / isValidPhone).
 * It's re-exported here so future callers can pull all three normalizers
 * from one place.
 */

export { normalizePhone, formatPhone, isValidPhone } from './phone'

export function normalizeEmail(input: string | null | undefined): string | null {
  if (input == null) return null
  const trimmed = input.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeInstagram(input: string | null | undefined): string | null {
  if (input == null) return null
  const trimmed = input.trim().toLowerCase().replace(/^@/, '')
  return trimmed.length > 0 ? trimmed : null
}
