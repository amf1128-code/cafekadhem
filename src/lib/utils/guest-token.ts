const STORAGE_KEY = 'cafe_kadhem_guest_token'
export const GUEST_TOKEN_EVENT = 'cafe_kadhem:guest_token_changed'

function emitChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(GUEST_TOKEN_EVENT))
}

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
    emitChange()
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
}

export function clearGuestToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    emitChange()
  } catch {
    // ignore
  }
}
