import { describe, expect, it } from 'vitest'
import { instagramUrl, isValidInstagram, normalizeInstagram } from './instagram'

describe('isValidInstagram', () => {
  it('accepts plain alphanumerics, underscores, periods', () => {
    expect(isValidInstagram('cafekadhem')).toBe(true)
    expect(isValidInstagram('cafe.kadhem')).toBe(true)
    expect(isValidInstagram('cafe_kadhem_007')).toBe(true)
  })

  it('accepts a handle with a leading @', () => {
    expect(isValidInstagram('@cafekadhem')).toBe(true)
  })

  it('rejects empty input', () => {
    expect(isValidInstagram('')).toBe(false)
  })

  it('rejects more than 30 characters', () => {
    expect(isValidInstagram('a'.repeat(31))).toBe(false)
  })

  it('rejects spaces and other punctuation', () => {
    expect(isValidInstagram('cafe kadhem')).toBe(false)
    expect(isValidInstagram('cafe-kadhem')).toBe(false)
    expect(isValidInstagram('cafe!kadhem')).toBe(false)
  })
})

describe('normalizeInstagram', () => {
  it('drops a leading @ and lowercases', () => {
    expect(normalizeInstagram('@CafeKadhem')).toBe('cafekadhem')
  })

  it('passes through a clean lowercase handle', () => {
    expect(normalizeInstagram('cafekadhem')).toBe('cafekadhem')
  })
})

describe('instagramUrl', () => {
  it('builds a profile URL', () => {
    expect(instagramUrl('cafekadhem')).toBe('https://instagram.com/cafekadhem')
  })

  it('strips a leading @', () => {
    expect(instagramUrl('@cafekadhem')).toBe('https://instagram.com/cafekadhem')
  })
})
