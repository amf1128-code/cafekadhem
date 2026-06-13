import { describe, expect, it } from 'vitest'
import { cartCount, cartTotal } from './cart'

describe('cartTotal', () => {
  it('sums unit price times quantity', () => {
    expect(
      cartTotal([
        { menuItem: { price: 5 }, quantity: 2 },
        { menuItem: { price: 3 }, quantity: 1 },
      ]),
    ).toBe(13)
  })
  it('treats a null unit price as zero', () => {
    expect(
      cartTotal([
        { menuItem: { price: null }, quantity: 4 },
        { menuItem: { price: 2.5 }, quantity: 2 },
      ]),
    ).toBe(5)
  })
  it('is zero for an empty cart', () => {
    expect(cartTotal([])).toBe(0)
  })
})

describe('cartCount', () => {
  it('sums quantities', () => {
    expect(cartCount([{ quantity: 2 }, { quantity: 3 }])).toBe(5)
  })
  it('is zero for an empty cart', () => {
    expect(cartCount([])).toBe(0)
  })
})
