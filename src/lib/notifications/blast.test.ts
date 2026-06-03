import { describe, expect, it, vi } from 'vitest'

// blast.ts imports the real supabase client at module load; stub it so the
// constant maps can be imported without env/network. These tests only
// assert the audience definitions, not createAndSendBlast.
vi.mock('../supabase', () => ({ supabase: {} }))

import { AUDIENCE_STATUSES, AUDIENCE_PAYMENT_STATUSES } from './blast'

describe('blast audiences', () => {
  it('unpaid_tickets = registered-or-going but unpaid', () => {
    expect(AUDIENCE_STATUSES.unpaid_tickets).toEqual(['pending_payment', 'yes'])
    // Only 'unpaid'. 'pending' = self-attested (counts as going), excluded;
    // 'paid'/'refunded' too.
    expect(AUDIENCE_PAYMENT_STATUSES.unpaid_tickets).toEqual(['unpaid'])
  })

  it('maybes = only maybe RSVPs, with no payment filter', () => {
    expect(AUDIENCE_STATUSES.maybes).toEqual(['maybe'])
    expect(AUDIENCE_PAYMENT_STATUSES.maybes).toBeUndefined()
  })

  it('legacy audiences are unchanged and not payment-filtered', () => {
    expect(AUDIENCE_STATUSES.yes_only).toEqual(['yes'])
    expect(AUDIENCE_STATUSES.yes_and_maybe).toEqual(['yes', 'maybe'])
    expect(AUDIENCE_STATUSES.all_invited).toEqual(['yes', 'maybe', 'no', 'waitlisted'])
    expect(AUDIENCE_PAYMENT_STATUSES.yes_only).toBeUndefined()
    expect(AUDIENCE_PAYMENT_STATUSES.all_invited).toBeUndefined()
  })
})
