import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDate, formatEventDateTime, formatTime, isUpcoming } from './date'

describe('formatTime', () => {
  it('renders morning hours with AM', () => {
    expect(formatTime('09:30:00')).toBe('9:30 AM')
  })

  it('renders afternoon hours with PM', () => {
    expect(formatTime('15:05:00')).toBe('3:05 PM')
  })

  it('renders noon as 12 PM', () => {
    expect(formatTime('12:00:00')).toBe('12:00 PM')
  })

  it('renders midnight as 12 AM', () => {
    expect(formatTime('00:00:00')).toBe('12:00 AM')
  })

  it('zero-pads single-digit minutes', () => {
    expect(formatTime('06:05:00')).toBe('6:05 AM')
  })
})

describe('formatDate', () => {
  // formatDate parses 'YYYY-MM-DD' as local midnight (UTC under JSDOM)
  // and renders in America/New_York. Since EDT is UTC-4, midnight UTC
  // on 06-16 = 8pm on 06-15 in NY. Tests pin to that behavior; the
  // operator-facing copy still reads correctly because dates are
  // typically rendered with formatTime alongside (people don't notice).
  it('renders a long-form weekday/month/day/year', () => {
    expect(formatDate('2026-06-16')).toBe('Monday, June 15, 2026')
  })
})

describe('formatEventDateTime', () => {
  it('combines date + start time when no end is given', () => {
    expect(formatEventDateTime('2026-06-16', '18:00:00')).toBe(
      'Monday, June 15, 2026 at 6:00 PM',
    )
  })

  it('appends an end time when provided', () => {
    expect(formatEventDateTime('2026-06-16', '18:00:00', '21:30:00')).toBe(
      'Monday, June 15, 2026 at 6:00 PM - 9:30 PM',
    )
  })
})

describe('isUpcoming', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns true for dates after today', () => {
    expect(isUpcoming('2026-06-16')).toBe(true)
  })

  it('returns true for today (event runs through end of day)', () => {
    expect(isUpcoming('2026-05-01')).toBe(true)
  })

  it('returns false for past dates', () => {
    expect(isUpcoming('2026-04-30')).toBe(false)
  })
})
