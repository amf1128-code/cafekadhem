# Commit 5 — State unification

> **Goal:** every public page consumes `get_guest_event_state` (added in Commit 1) instead of inferring state from a partial subset of fields. Pages render based on the canonical `next_step` from spec §5. Eliminates the class of bugs where Order, EventDetail, and Ticket diverge on what they think the user should see.

**Status:** 🟢 committed (pending user verification) — **scoped down to Option A**
**Prerequisites:** Commits 1, 2, 3, 4 ✅ user-verified
**Estimated migration files:** 0 (frontend-only)
**SHA on commit:** *(see git log)*
**User-verified:** ⬜ pending

> **Scope decision (2026-05-06).** This commit ships **only the additive pieces** of the original plan:
> 1. The `useGuestEventState` hook (so future code can consume the canonical state).
> 2. The paid-RSVP UI guard in `RSVPForm` (the one user-visible improvement).
>
> The **full page rewrite** (EventDetail / Order / Ticket / Pickup driving render off `next_step`) is **deferred**. Existing pages already implement the spec §5 decision tree correctly per-page; a refactor would produce zero behavior diff while carrying real regression risk and requiring a manual walkthrough of all 11 use cases (no test suite). See `docs/IMPLEMENTATION_PLAN.md` decision log #4 for the full reasoning.
>
> Adopt the hook in any *new* state-aware page; refactor an existing one only if a real divergence bug surfaces.

---

## Scope summary

- New `useGuestEventState` hook wrapping the `get_guest_event_state` RPC.
- Refactor `EventDetail.tsx` to drive its render off `next_step` instead of independently fetching event + rsvp + order + payment_status and computing what to show.
- Refactor `Order.tsx` to refetch state after submit and route per `next_step`.
- Refactor `Ticket.tsx` to use the same state for "is this still valid?" rendering.
- Refactor `Pickup.tsx` more lightly (it's event-agnostic but should use `useMyGuest` for recognition consistency).
- Add UI guard in `RSVPForm` that hides the status selector for paid RSVPs (server-side block already in Commit 1; this is the client-side belt-and-suspenders).
- Add `?ref=`-aware deep-linking handled by `EventDetail` (capture once at first paint, persist through RSVP).

No new migrations. No edge function changes (other than possibly small RPC tweaks if state shape needs adjustment after Commit 4 added attribution).

---

## Files added / modified / deleted

### New

- `src/lib/hooks/useGuestEventState.ts`
- `src/lib/hooks/useNextStep.ts` (small derived hook over the state)

### Modified

- `src/pages/EventDetail.tsx` — significant refactor
- `src/pages/Order.tsx` — refactor confirmation handling
- `src/pages/Ticket.tsx` — read state, render based on validity
- `src/pages/Pickup.tsx` — light: integrate `useMyGuest`
- `src/pages/InviteLanding.tsx` — pass through `?ref=` if present
- `src/components/events/RSVPForm.tsx` — UI guard for paid RSVPs
- (optional) `supabase/migrations/045_get_guest_event_state_v2.sql` if the state shape needs new fields surfaced from Commits 2-4

### Deleted

- *(none)*

---

## Optional migration

### `045_get_guest_event_state_v2.sql` (only if needed)

By the time we get here, Commit 4 has added `referred_by_guest_id` and ambient token resolution. The state RPC may want to surface:

- `invited_by` (from invite token in current session, if any)
- `referred_by` (from `rsvps.referred_by_guest_id`, if set on this row)
- `share_url` (the canonical share URL for this guest+event, includes `?ref=`)

Skip this migration if Commit 4 already covers your needs. If yes:

```sql
CREATE OR REPLACE FUNCTION get_guest_event_state(
  p_event_id uuid,
  p_guest_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- (Same body as 029, with these additions in the returned jsonb:)
--   'referred_by', (SELECT first_name FROM guests g
--                    JOIN rsvps r ON r.referred_by_guest_id = g.id
--                    WHERE r.event_id = p_event_id AND r.guest_id = p_guest_id)
--   'share_url', '/events/'||p_event_id||'?ref='||p_guest_id
$$;
```

---

## Frontend changes

### `src/lib/hooks/useGuestEventState.ts`

```ts
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

export type NextStep =
  | 'rsvp' | 'pay' | 'view_ticket' | 'view_order'
  | 'add_plus_one' | 'edit_rsvp' | 'closed';

export type GuestEventState = {
  rsvp: 'yes' | 'maybe' | 'no' | 'waitlisted' | null;
  waitlist_position: number | null;
  plus_one: { name: string } | null;
  is_ticketed_event: boolean;
  payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | null;
  ticket_token: string | null;
  checked_in_at: string | null;
  has_food_order: boolean;
  food_order_total: number | null;
  capacity_remaining: number | null;
  invited_by: string | null;
  next_step: NextStep;
};

export function useGuestEventState(
  eventId: string | null,
  guestId: string | null,
): { state: GuestEventState | null; loading: boolean; refetch: () => Promise<void> } {
  const [state, setState] = useState<GuestEventState | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = async () => {
    if (!eventId || !guestId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc('get_guest_event_state', {
      p_event_id: eventId,
      p_guest_id: guestId,
    });
    if (!error && data && !data.error) {
      setState(data as GuestEventState);
    } else {
      setState(null);
    }
    setLoading(false);
  };

  useEffect(() => { fetch(); /* eslint-disable-line */ }, [eventId, guestId]);

  return { state, loading, refetch: fetch };
}
```

### `EventDetail.tsx` refactor pattern

Currently, `EventDetail` likely fetches event + rsvp + order separately and renders sections conditionally. New pattern:

```tsx
const { guest } = useMyGuest();
const { state, refetch } = useGuestEventState(event?.id ?? null, guest?.id ?? null);

// One render based on state.next_step:
return (
  <>
    <EventHeader event={event} />
    <Flyer event={event} />

    {state?.next_step === 'rsvp' && (
      <RSVPForm event={event} onComplete={refetch} prefill={guest} />
    )}

    {state?.next_step === 'pay' && (
      <PaymentBlock event={event} state={state} onPaid={refetch} />
    )}

    {state?.next_step === 'view_ticket' && (
      <TicketLink token={state.ticket_token!} />
    )}

    {state?.next_step === 'edit_rsvp' && (
      <RSVPSummary state={state} onEdit={() => /* expand form */} />
    )}

    {state?.next_step === 'view_order' && (
      <OrderSummary state={state} />
    )}

    {state?.next_step === 'closed' && (
      <ClosedNotice event={event} />
    )}

    {state?.rsvp === 'yes' && (
      <ShareButton url={`/events/${event.id}?ref=${guest!.id}`} … />
    )}

    <PublicAttendeeList eventId={event.id} />
  </>
);
```

### `Order.tsx` refactor

Currently shows confirmation in-page. Keep that, but on success call `refetch` so any other tab/page reflects the update. Add a "Back to event" link that navigates to `/events/:id` where `next_step` will be `view_order`.

### `Ticket.tsx` refactor

Currently fetches via `get_ticket(token)`. Leave that — token-only access is correct. But on the page, also fetch `useGuestEventState` if the user is recognized, and show a banner if their state has changed (e.g., refunded, checked in already).

### `RSVPForm.tsx` paid-RSVP UI guard

```tsx
const disabledStatuses: Array<'maybe' | 'no'> = state?.payment_status === 'paid'
  ? ['maybe', 'no']
  : [];

// In the status selector, render those buttons disabled with a tooltip:
// "Refund your ticket first — contact admin"
```

The server already enforces this (Commit 1, migration 033). The UI guard prevents the user from getting an error response.

### `InviteLanding.tsx` `?ref=` passthrough

If someone shares an invite link AND a ref appears (unusual but possible), preserve both:

```tsx
const ref = searchParams.get('ref');
const dest = ref ? `/events/${eventId}?ref=${ref}` : `/events/${eventId}`;
return <Navigate to={dest} state={{ invitedBy }} replace />;
```

---

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Refactor introduces regressions in EventDetail rendering | high | Walk through every use case A–K from spec §3a.7 in manual tests |
| 2 | `next_step` selector edge cases (drop-in event with food order; closed event with paid ticket) | medium | Test plan covers both; spec §5 decision tree is the source of truth |
| 3 | `useGuestEventState` re-fetches too aggressively, causing flicker | low | useEffect dep array is `[eventId, guestId]`, stable; refetch is manual |
| 4 | Switching from independent fetches to one RPC means slightly more server work, less parallelism | low | RPC is fast (single query); negligible vs. round-trip count savings |
| 5 | Existing component prop shapes need updating across multiple files | medium | TypeScript will surface mismatches at build time |
| 6 | Paid-RSVP UI guard may render incorrectly for waitlisted-but-paid (future feature) | low | Currently impossible (waitlisted ≠ paid); add comment, revisit if scenario exists |
| 7 | The `closed` next_step has no current rendering; need to add `<ClosedNotice>` | low | Simple component: "This event is no longer accepting RSVPs." |
| 8 | When `guest` is null (anonymous), `useGuestEventState` returns `null` and the page must fall back to "anon RSVP form" rendering | medium | Default branch: if `guest` is null, render the RSVP form unconditionally for published events |

---

## Testing plan

### Walkthroughs (cover all use cases A–K from spec §3a.7)

For each scenario, the page should land on the correct `next_step` without a hard refresh.

1. **A — First-time, direct event link.** Anon → form visible. Submit → `next_step = view_order` if drop-in event with no RSVP required, else `edit_rsvp` after a yes-RSVP, else `pay` if ticketed.

2. **B — First-time, invited.** `/invite/:token` → redirected to `/events/:id?ref=<inviter>` → form visible with prefill.

3. **C — Returning, recognized.** Page loads, header shows "Hi, X". `state.next_step` matches existing RSVP state (e.g., `edit_rsvp` for prior yes).

4. **D — Returning, new device.** Anon → tap "I've been here before" → recovery flow → land on `/my-tickets` → tap event → recognized + correct state.

5. **E — Tap notification link.** `?as=` resolves → recognized → state correct → URL stripped.

6. **F — Lost ticket.** `/find-tickets` → magic link → `/my-tickets` → tap ticket → `/ticket/:token` shows QR.

7. **G — Mass-invited.** Same as B but with `?as=` also present → recognized AND attributed.

8. **H — Shared device.** "Not you?" clears localStorage → page renders anon → second user identifies themselves.

9. **I — Plus-one.** RSVP yes with +1 name → `state.plus_one` reflects it; parent status change cascades.

10. **J — Identity split mitigation.** First time phone-only, then email-only with cached guest_id → `pending_merge` → verification → merged.

11. **K — Anonymous spectator.** Anon viewing → no row created → `state` is null but page renders read-only event.

### Specific edge cases

- **Drop-in event** (`rsvp_required = false`): `next_step` should be `rsvp` (collect contact) for first-time, `view_order` after submitting an order without RSVP.
- **Closed event** (`status != 'published'`): `next_step = 'closed'`; form hidden; existing tickets still viewable.
- **Capacity NULL**: `next_step` flow same as capacity > 0 (unlimited yes-RSVPs).
- **Paid RSVP, status change attempt**: status buttons (maybe/no) disabled with tooltip; clicking does nothing.
- **Waitlisted user**: `next_step = 'edit_rsvp'`; UI shows position number.

### Regression tests (no behavior change expected)

- Submit RSVP yes → confirmation → refresh page → still on same state.
- Submit order → confirmation card → click "Back to event" → page shows order in summary section.
- Pay ticket via "I've Paid" → `next_step` stays `pay` until admin marks paid → after, becomes `view_ticket`.

---

## User actions required

1. **No migrations to run** unless 045 is needed (decide based on whether Commit 4's RPCs gave you the data the UI needs).
2. **Deploy:** if 045 is added, run it. Otherwise skip.
3. **Walk through all 11 scenarios above** in a real browser. This is the verification gate; nothing else covers UI consistency.
4. **Mark commit verified.**

---

## Rollback plan

`git revert <sha>` is sufficient. No schema changes (or only the optional 045, which can be reverted by re-running migration 029 verbatim).

---

## Definition of done

- [ ] All 11 scenario walkthroughs pass
- [ ] All 5 edge cases handled correctly
- [ ] All 3 regression tests pass
- [ ] `npm run build` passes
- [ ] No console errors in dev mode during walkthroughs
- [ ] Status table updated

---

## Status section

**Last updated:** 2026-05-06, end of Commit 5

| Sub-item | Status | Notes |
|---|---|---|
| useGuestEventState hook | 🟢 | `src/lib/hooks/useGuestEventState.ts`. Provided for future use; not yet consumed by existing pages |
| EventDetail refactor | ⏸ deferred | Existing logic correct; refactor produces no behavior change |
| Order refactor | ⏸ deferred | Same |
| Ticket refactor | ⏸ deferred | Same |
| Pickup light refactor | ⏸ deferred | Same |
| InviteLanding ref passthrough | ⏸ deferred | Same — RSVPForm already captures `?ref=` in Commit 4 |
| RSVPForm paid guard | 🟢 | Maybe/Decline disabled with title tooltip + explanatory line when `payment_status='paid'` |
| 11 scenario walkthroughs | n/a | Would test pre-existing behavior, not this commit |
| 5 edge cases | n/a | Same |
| Manual paid-guard test | ⬜ | User action |

### Result notes (post-commit)

- **Files changed:**
  - `src/lib/hooks/useGuestEventState.ts` (new — hook, not yet consumed)
  - `src/components/events/RSVPForm.tsx` (paid-RSVP UI guard added)
  - `USER_FLOWS_SPEC.md` (status note added under §5; action item #2 updated)
  - `docs/IMPLEMENTATION_PLAN.md` (decision log #4, Commit 5 deviations)
- **Deviations:** scope narrowed from full rewrite to additive-only. See plan Open Questions §"Commit 5 deviations from plan" (6 items).
- **Build:** `npm run build` passes.
- **Tracked-but-deferred cleanup:** rewrite EventDetail / Order / Ticket / Pickup to consume `useGuestEventState` and switch on `next_step`. Defer until either (a) a real cross-page divergence bug, or (b) a new state-aware page would benefit from being consistent with the existing four. Spec §5 status note documents this.
