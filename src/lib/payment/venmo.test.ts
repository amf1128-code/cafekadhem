import { describe, expect, it } from 'vitest'
import { buildVenmoNote } from './venmo'

describe('buildVenmoNote', () => {
  it('returns just name and event when there are no items', () => {
    expect(
      buildVenmoNote({ firstName: 'Anas', eventTitle: 'Persepolis Screening' }),
    ).toBe('Anas - Persepolis Screening')
  })

  it('lists every item when the full note fits', () => {
    expect(
      buildVenmoNote({
        firstName: 'Anas',
        eventTitle: 'Persepolis Screening',
        items: [
          { name: 'Coffee', quantity: 2 },
          { name: 'Knafeh', quantity: 1 },
        ],
      }),
    ).toBe('Anas - Persepolis Screening (Coffee x2, Knafeh)')
  })

  it('uses "x{n}" only when quantity > 1', () => {
    expect(
      buildVenmoNote({
        firstName: 'Sam',
        eventTitle: 'Movie Night',
        items: [{ name: 'Tea', quantity: 1 }],
      }),
    ).toBe('Sam - Movie Night (Tea)')
  })

  it('truncates the item list with "and X more items" when too long', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      name: `MenuItemWithAFairlyLongName${i}`,
      quantity: 1,
    }))
    const note = buildVenmoNote({
      firstName: 'Anas',
      eventTitle: 'Persepolis Screening',
      items,
    })
    expect(note.length).toBeLessThanOrEqual(270)
    expect(note).toMatch(/ and \d+ more items\)$/)
  })

  it('uses "1 more item" (singular) when exactly one is dropped', () => {
    const items = [
      { name: 'A'.repeat(100), quantity: 1 },
      { name: 'B'.repeat(200), quantity: 1 },
    ]
    const note = buildVenmoNote({
      firstName: 'Anas',
      eventTitle: 'Persepolis',
      items,
    })
    expect(note).toContain('and 1 more item)')
    expect(note).not.toContain('and 1 more items')
  })

  it('falls back to the bare name+event when no items can fit', () => {
    const longTitle = 'X'.repeat(260)
    const note = buildVenmoNote({
      firstName: 'Anas',
      eventTitle: longTitle,
      items: [{ name: 'Item', quantity: 1 }],
    })
    // Even "(1 item)" pushes past 270, so the parenthetical is dropped.
    expect(note).toBe(`Anas - ${longTitle}`)
  })
})
