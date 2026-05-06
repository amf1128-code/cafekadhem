import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Reset the rendered DOM + clear localStorage between tests so identity
// state and useMyGuest subscriptions don't leak across cases.
afterEach(() => {
  cleanup()
  localStorage.clear()
})

// matchMedia isn't implemented in JSDOM. Return a stub so any component
// that probes it during render doesn't crash.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList
}
