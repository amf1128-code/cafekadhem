/**
 * Validate Instagram handle format.
 * Allows alphanumeric characters, underscores, and periods.
 */
export function isValidInstagram(handle: string): boolean {
  const cleaned = handle.replace(/^@/, '')
  return /^[a-zA-Z0-9._]{1,30}$/.test(cleaned)
}

/**
 * Normalize Instagram handle: strip @ prefix, lowercase.
 */
export function normalizeInstagram(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase()
}

/**
 * Get the Instagram profile URL for a handle.
 */
export function instagramUrl(handle: string): string {
  const cleaned = handle.replace(/^@/, '')
  return `https://instagram.com/${cleaned}`
}
