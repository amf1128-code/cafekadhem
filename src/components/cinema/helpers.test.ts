import { describe, expect, it } from 'vitest'
import {
  buildPlusOneCount,
  formatCinemaDate,
  formatCinemaDay,
  formatCinemaTime,
  interleaveAlternating,
  makeDisplayTitle,
  padNo,
  splitBullets,
} from './helpers'

describe('interleaveAlternating', () => {
  it('strictly alternates equal-length arrays', () => {
    expect(interleaveAlternating(['a', 'b', 'c'], ['1', '2', '3'])).toEqual([
      'a',
      '1',
      'b',
      '2',
      'c',
      '3',
    ])
  })

  it('appends leftovers when the first list is longer', () => {
    expect(interleaveAlternating(['a', 'b', 'c'], ['1'])).toEqual([
      'a',
      '1',
      'b',
      'c',
    ])
  })

  it('appends leftovers when the second list is longer', () => {
    expect(interleaveAlternating(['a'], ['1', '2', '3'])).toEqual([
      'a',
      '1',
      '2',
      '3',
    ])
  })

  it('handles empty inputs', () => {
    expect(interleaveAlternating([], [])).toEqual([])
    expect(interleaveAlternating(['only'], [])).toEqual(['only'])
  })
})

describe('padNo', () => {
  it('pads short numbers to 3 digits', () => {
    expect(padNo('14', 'fallback')).toBe('014')
    expect(padNo(7, 'fallback')).toBe('007')
  })

  it('passes through already-3+ digit values', () => {
    expect(padNo('014', 'fallback')).toBe('014')
    expect(padNo('1402', 'fallback')).toBe('1402')
  })

  it('strips leading "No." prefix admins type into the field', () => {
    expect(padNo('No. 006', 'fallback')).toBe('006')
    expect(padNo('NO 14', 'fallback')).toBe('014')
    expect(padNo('Number 6', 'fallback')).toBe('006')
    expect(padNo('# 12', 'fallback')).toBe('012')
  })

  it('returns fallback for null / undefined / empty / blank prefix-only', () => {
    expect(padNo(null, 'F')).toBe('F')
    expect(padNo(undefined, 'F')).toBe('F')
    expect(padNo('', 'F')).toBe('F')
    expect(padNo('No.', 'F')).toBe('F')
  })
})

describe('formatCinemaDate', () => {
  it('renders YYYY-MM-DD as MM.DD.YY', () => {
    expect(formatCinemaDate('2026-06-16')).toBe('06.16.26')
    expect(formatCinemaDate('2025-12-31')).toBe('12.31.25')
  })

  it('passes through unrecognized formats', () => {
    expect(formatCinemaDate('not a date')).toBe('not a date')
  })
})

describe('formatCinemaDay', () => {
  it('renders three-letter weekday in caps', () => {
    // 2026-06-16 noon ET is a Tuesday.
    expect(formatCinemaDay('2026-06-16')).toBe('TUE')
    expect(formatCinemaDay('2026-06-15')).toBe('MON')
  })
})

describe('formatCinemaTime', () => {
  it('renders open-ended ranges as "TILL LATE"', () => {
    expect(formatCinemaTime('18:00', null)).toBe('6PM TILL LATE')
    expect(formatCinemaTime('09:00', null)).toBe('9AM TILL LATE')
  })

  it('renders closed ranges with em-dash', () => {
    expect(formatCinemaTime('18:00', '21:30')).toBe('6PM – 9PM')
  })

  it('handles noon and midnight', () => {
    expect(formatCinemaTime('12:00', null)).toBe('12PM TILL LATE')
    expect(formatCinemaTime('00:00', null)).toBe('12AM TILL LATE')
  })
})

describe('splitBullets', () => {
  it('splits multi-line text into one bullet per line', () => {
    expect(
      splitBullets('Iraq v Norway · 6pm kickoff\nPistachio buns hot at 9pm\nProceeds to WCK'),
    ).toEqual([
      'Iraq v Norway · 6pm kickoff',
      'Pistachio buns hot at 9pm',
      'Proceeds to WCK',
    ])
  })

  it('strips leading list markers (-, •, ·, *)', () => {
    expect(splitBullets('- one\n• two\n· three\n* four')).toEqual([
      'one',
      'two',
      'three',
      'four',
    ])
  })

  it('caps to 4 bullets', () => {
    expect(splitBullets('a\nb\nc\nd\ne\nf')).toHaveLength(4)
  })

  it('falls back to sentence splitting on a single line', () => {
    expect(
      splitBullets('Football all night. Free knafeh croissants at half. Loud as hell.'),
    ).toEqual([
      'Football all night.',
      'Free knafeh croissants at half.',
      'Loud as hell.',
    ])
  })

  it('returns [] for null / empty input', () => {
    expect(splitBullets(null)).toEqual([])
    expect(splitBullets('')).toEqual([])
  })
})

describe('makeDisplayTitle', () => {
  it('upper-cases short titles without breaking', () => {
    expect(makeDisplayTitle('Tarab Friday')).toBe('TARAB FRIDAY')
  })

  it('preserves an explicit newline if the operator put one in', () => {
    expect(makeDisplayTitle('WORLD CUP\nWATCH PARTY')).toBe(
      'WORLD CUP\nWATCH PARTY',
    )
  })

  it('inserts a line break around the midpoint of long titles', () => {
    expect(makeDisplayTitle('World Cup Watch Party')).toBe('WORLD CUP\nWATCH PARTY')
  })

  it('chooses the closer of the two surrounding spaces', () => {
    // "Cinema Under the BQE" length 20 → mid=10. Nearest space after
    // mid is at 12 (after "Under"); nearest before is at 6 (after
    // "Cinema"). 12-10=2 vs 10-6=4 → after wins.
    expect(makeDisplayTitle('Cinema Under the BQE')).toBe('CINEMA UNDER\nTHE BQE')
  })

  it('passes single-word long titles through (no breakable space)', () => {
    expect(makeDisplayTitle('Indeterminate-Length-One-Word')).toBe(
      'INDETERMINATE-LENGTH-ONE-WORD',
    )
  })
})

describe('buildPlusOneCount', () => {
  it('groups plus-ones by host RSVP id', () => {
    const rsvps = [
      { id: 'h1', plus_one_of: null },
      { id: 'h2', plus_one_of: null },
      { id: 'p1', plus_one_of: 'h1' },
      { id: 'p2', plus_one_of: 'h2' },
    ]
    const map = buildPlusOneCount(rsvps)
    expect(map.get('h1')).toBe(1)
    expect(map.get('h2')).toBe(1)
    expect(map.size).toBe(2)
  })

  it('counts multiple plus-ones for the same host', () => {
    const rsvps = [
      { id: 'h1', plus_one_of: null },
      { id: 'p1', plus_one_of: 'h1' },
      { id: 'p2', plus_one_of: 'h1' },
    ]
    expect(buildPlusOneCount(rsvps).get('h1')).toBe(2)
  })

  it('returns an empty map when there are no plus-ones', () => {
    const rsvps = [{ id: 'h1', plus_one_of: null }]
    expect(buildPlusOneCount(rsvps).size).toBe(0)
  })
})
