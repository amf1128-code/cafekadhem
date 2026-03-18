const STORAGE_KEY = 'cafe_kadhem_guest_token'

export function getGuestToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setGuestToken(guestId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, guestId)
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
}

export function clearGuestToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
