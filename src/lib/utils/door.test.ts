import { describe, it, expect } from 'vitest'
import type { RSVP, Guest } from '../types'
import {
  tokenFromValue,
  venmoProfileUrl,
  needsPayment,
  isAttendingEligible,
  attendeeMatchesSearch,
  compareAttendees,
  visibleAttendees,
  type AttendeeRow,
} from './door'

function row(over: Omit<Partial<RSVP>, 'guest'> & { guest?: Partial<Guest> } = {}): AttendeeRow {
  const { guest, ...rsvp } = over
  return {
    id: rsvp.id || 'r1',
    event_id: 'e1',
    guest_id: 'g1',
    status: rsvp.status || 'yes',
    waitlist_position: null,
    waitlisted_at: null,
    payment_status: rsvp.payment_status || 'paid',
    ticket_token: rsvp.ticket_token ?? null,
    paid_at: rsvp.paid_at ?? null,
    checked_in_at: rsvp.checked_in_at ?? null,
    plus_one_of: rsvp.plus_one_of ?? null,
    notes: rsvp.notes ?? null,
    walk_in: rsvp.walk_in ?? false,
    created_at: rsvp.created_at || '2026-01-01',
    updated_at: '2026-01-01',
    guest: {
      id: 'g1',
      first_name: guest?.first_name ?? 'Ali',
      last_name: guest?.last_name ?? 'Kadhem',
      email: guest?.email ?? null,
      phone: guest?.phone ?? null,
      instagram: null,
      notification_preference: 'email',
      added_as_plus_one_by: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
  } as AttendeeRow
}

describe('tokenFromValue', () => {
  it('extracts a token from a ticket URL', () => {
    expect(tokenFromValue('https://cafekadhem.com/ticket/abcdef0123456789')).toBe(
      'abcdef0123456789',
    )
  })
  it('accepts a bare hex token', () => {
    expect(tokenFromValue('  ABCDEF0123456789  ')).toBe('ABCDEF0123456789')
  })
  it('rejects junk and empty input', () => {
    expect(tokenFromValue('hello world')).toBeNull()
    expect(tokenFromValue('')).toBeNull()
    expect(tokenFromValue('https://cafekadhem.com/events/123')).toBeNull()
  })
})

describe('venmoProfileUrl', () => {
  it('strips a leading @ and trims', () => {
    expect(venmoProfileUrl('  @cafekadhem ')).toBe('https://venmo.com/cafekadhem')
  })
})

describe('needsPayment', () => {
  it('flags unpaid going + registered rows', () => {
    expect(needsPayment(row({ status: 'yes', payment_status: 'unpaid' }))).toBe(true)
    expect(needsPayment(row({ status: 'pending_payment', payment_status: 'unpaid' }))).toBe(true)
  })
  it('does not flag paid or self-attested rows', () => {
    expect(needsPayment(row({ payment_status: 'paid' }))).toBe(false)
    expect(needsPayment(row({ status: 'yes', payment_status: 'pending' }))).toBe(false)
  })
  it('never flags plus-ones (the host covers them)', () => {
    expect(needsPayment(row({ status: 'yes', payment_status: 'unpaid', plus_one_of: 'host1' }))).toBe(
      false,
    )
  })
})

describe('isAttendingEligible', () => {
  it('includes going, registered, waitlisted, and checked-in rows', () => {
    expect(isAttendingEligible(row({ status: 'yes' }))).toBe(true)
    expect(isAttendingEligible(row({ status: 'pending_payment' }))).toBe(true)
    expect(isAttendingEligible(row({ status: 'waitlisted' }))).toBe(true)
    expect(isAttendingEligible(row({ status: 'no', checked_in_at: '2026-01-01T20:00:00Z' }))).toBe(true)
  })
  it('hides declined / maybe by default', () => {
    expect(isAttendingEligible(row({ status: 'no' }))).toBe(false)
    expect(isAttendingEligible(row({ status: 'maybe' }))).toBe(false)
  })
})

describe('attendeeMatchesSearch', () => {
  it('matches name, email, and phone', () => {
    const r = row({ guest: { first_name: 'Lina', last_name: 'B', email: 'lina@x.com', phone: '+15551234567' } })
    expect(attendeeMatchesSearch(r, 'lina')).toBe(true)
    expect(attendeeMatchesSearch(r, 'lina@x')).toBe(true)
    expect(attendeeMatchesSearch(r, '5551234')).toBe(true)
    expect(attendeeMatchesSearch(r, 'zzz')).toBe(false)
  })
  it('empty query matches nothing', () => {
    expect(attendeeMatchesSearch(row(), '   ')).toBe(false)
  })
})

describe('compareAttendees / visibleAttendees', () => {
  it('puts not-checked-in first, then alphabetical', () => {
    const checkedIn = row({ id: 'a', checked_in_at: '2026-01-01T20:00:00Z', guest: { first_name: 'Aaron' } })
    const waiting = row({ id: 'b', guest: { first_name: 'Zoe' } })
    const sorted = [checkedIn, waiting].sort(compareAttendees)
    expect(sorted[0].id).toBe('b')
  })
  it('search surfaces a declined guest who would be hidden by default', () => {
    const declined = row({ id: 'd', status: 'no', guest: { first_name: 'Walkin', last_name: 'Sam' } })
    const going = row({ id: 'g', status: 'yes', guest: { first_name: 'Other' } })
    expect(visibleAttendees([declined, going], '').map(r => r.id)).toEqual(['g'])
    expect(visibleAttendees([declined, going], 'sam').map(r => r.id)).toEqual(['d'])
  })
})
