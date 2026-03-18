/**
 * Normalize a phone number to E.164 format.
 * Assumes US numbers if no country code is provided.
 */
export function normalizePhone(phone: string): string {
  // Strip everything except digits and leading +
  const stripped = phone.replace(/[^\d+]/g, '')

  // Already has country code
  if (stripped.startsWith('+')) {
    return stripped
  }

  // Remove leading 1 if it's a US number with country code
  const digits = stripped.replace(/^\+/, '')

  if (digits.length === 10) {
    return `+1${digits}`
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }

  // Return as-is with + prefix if we can't determine format
  return `+${digits}`
}

/**
 * Format a phone number for display.
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')

  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4)
    const prefix = digits.slice(4, 7)
    const line = digits.slice(7)
    return `(${area}) ${prefix}-${line}`
  }

  if (digits.length === 10) {
    const area = digits.slice(0, 3)
    const prefix = digits.slice(3, 6)
    const line = digits.slice(6)
    return `(${area}) ${prefix}-${line}`
  }

  return phone
}

/**
 * Basic phone number validation.
 */
export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}
