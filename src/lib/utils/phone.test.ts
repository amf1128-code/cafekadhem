import { describe, expect, it } from 'vitest'
import { formatPhone, isValidPhone, normalizePhone } from './phone'

// Valid US numbers used throughout: NANP requires the area code's first
// digit AND the exchange code's first digit to be 2–9. Using 555-234-5678
// keeps both gates happy without colliding with directory numbers.
const VALID_10 = '5552345678'
const VALID_11 = `1${VALID_10}`

describe('normalizePhone', () => {
  it('adds +1 to a 10-digit US number', () => {
    expect(normalizePhone(VALID_10)).toBe(`+${VALID_11}`)
  })

  it('strips formatting characters', () => {
    expect(normalizePhone('(555) 234-5678')).toBe(`+${VALID_11}`)
    expect(normalizePhone('555.234.5678')).toBe(`+${VALID_11}`)
    expect(normalizePhone('555 234 5678')).toBe(`+${VALID_11}`)
  })

  it('preserves an already-prefixed E.164 number', () => {
    expect(normalizePhone('+447911123456')).toBe('+447911123456')
  })

  it('promotes a leading 1 (country code) to +1', () => {
    expect(normalizePhone(VALID_11)).toBe(`+${VALID_11}`)
  })
})

describe('formatPhone', () => {
  it('renders an 11-digit number as (area) prefix-line', () => {
    expect(formatPhone(VALID_11)).toBe('(555) 234-5678')
  })

  it('renders a 10-digit number as (area) prefix-line', () => {
    expect(formatPhone(VALID_10)).toBe('(555) 234-5678')
  })

  it('passes through unrecognized formats', () => {
    expect(formatPhone('+447911123456')).toBe('+447911123456')
  })
})

describe('isValidPhone', () => {
  it('accepts a valid 10-digit NANP number', () => {
    expect(isValidPhone(VALID_10)).toBe(true)
  })

  it('accepts a valid 11-digit number with country code', () => {
    expect(isValidPhone(VALID_11)).toBe(true)
  })

  it('rejects fewer than 10 digits', () => {
    expect(isValidPhone('555234567')).toBe(false)
    expect(isValidPhone('')).toBe(false)
  })

  it('rejects an area code starting with 0 or 1', () => {
    expect(isValidPhone('1552345678')).toBe(false)
    expect(isValidPhone('0552345678')).toBe(false)
  })

  it('rejects an exchange starting with 0 or 1 per NANP', () => {
    // 555-123-4567 has exchange 123 (starts with 1) — invalid by NANP.
    expect(isValidPhone('5551234567')).toBe(false)
    expect(isValidPhone('5550234567')).toBe(false)
    // 555-234-5678 has exchange 234 (starts with 2) — valid.
    expect(isValidPhone('5552345678')).toBe(true)
  })
})
