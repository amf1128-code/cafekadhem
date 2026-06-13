import { describe, expect, it } from 'vitest'
import { formatAmount, formatUsd } from './money'

describe('formatUsd', () => {
  it('prefixes a dollar sign and fixes to 2 decimals', () => {
    expect(formatUsd(12)).toBe('$12.00')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(3.5)).toBe('$3.50')
    expect(formatUsd(9.999)).toBe('$10.00')
  })
})

describe('formatAmount', () => {
  it('fixes to 2 decimals with no symbol', () => {
    expect(formatAmount(12)).toBe('12.00')
    expect(formatAmount(3.5)).toBe('3.50')
  })
  it('treats null/undefined as zero', () => {
    expect(formatAmount(null)).toBe('0.00')
    expect(formatAmount(undefined)).toBe('0.00')
  })
})
