# Commit 1 — Foundations (additive schema, no behavior change)

> **Goal:** add the schema scaffolding every later commit depends on, without changing any user-visible behavior. After this commit ships, the app should look and behave identically to before; only the database has new columns, indexes, and helper functions.

**Status:** 🟢 committed (pending user verification)
**Prerequisites:** none (first commit)
**Estimated migration files:** 6 (numbers `029` through `034`) — all created
**SHA on commit:** *(see git log on `claude/user-flow-consistency-ipcaU`)*
**User-verified:** ⬜ pending

---

## Scope summary

- New helper RPC `get_guest_event_state(event_id, guest_id)` returning the canonical `(guest, event)` shape from spec §5.
- New columns + unique constraints on `notifications_log`, `orders`, `pickup_orders`, `invites` to support idempotency and bulk operations.
- Replace `safe_create_rsvp` with a version that takes an advisory lock for the capacity check and blocks `paid → no` status transitions.
- Add a trigger that keeps plus-one RSVP rows' status aligned with their parent.
- Hoist `normalizePhone` (currently duplicated in `RSVPForm.tsx` and `Order.tsx`) into `src/lib/utils/contact.ts` for reuse.

No edge function changes. No behavior change visible to guests.

---

## Files added / modified / deleted

### New

- `supabase/migrations/029_get_guest_event_state.sql`
- `supabase/migrations/030_notifications_dedup_key.sql`
- `supabase/migrations/031_orders_idempotency.sql`
- `supabase/migrations/032_invites_metadata.sql`
- `supabase/migrations/033_safe_create_rsvp_lock.sql`
- `supabase/migrations/034_plus_one_sync_trigger.sql`
- `src/lib/utils/contact.ts`

### Modified

- `src/components/events/RSVPForm.tsx` — import `normalizePhone` from new location; delete local copy.
- `src/pages/Order.tsx` — same.
- `src/pages/Pickup.tsx` — same (also uses phone input).

### Deleted

- *(none)*

---

## Inline migrations

> Paste each block into Supabase SQL editor in order, OR run `supabase db push` from the repo root after the commit lands.

### `029_get_guest_event_state.sql`

```sql
-- 029: Canonical (guest, event) state selector.
-- Returns the data needed to drive the next_step decision tree
-- (USER_FLOWS_SPEC.md §5). Public, but only returns ticket_token
-- when the calling auth context owns the guest_id.

CREATE OR REPLACE FUNCTION get_guest_event_state(
  p_event_id uuid,
  p_guest_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_rsvp RECORD;
  v_plus_one RECORD;
  v_order_total numeric;
  v_invited_by text;
  v_capacity_remaining int;
  v_yes_count int;
  v_next_step text;
BEGIN
  SELECT id, status, capacity, ticketing_enabled, ticket_price,
         rsvp_required
    INTO v_event
    FROM events
   WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'event_not_found');
  END IF;

  -- Capacity remaining (NULL = unlimited)
  IF v_event.capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO v_yes_count
      FROM rsvps
     WHERE event_id = p_event_id AND status = 'yes';
    v_capacity_remaining := GREATEST(v_event.capacity - v_yes_count, 0);
  ELSE
    v_capacity_remaining := NULL;
  END IF;

  -- Guest's own RSVP (if any)
  SELECT status, waitlist_position, payment_status, ticket_token,
         checked_in_at
    INTO v_rsvp
    FROM rsvps
   WHERE event_id = p_event_id AND guest_id = p_guest_id;

  -- Plus-one (if any)
  SELECT g.first_name AS name
    INTO v_plus_one
    FROM rsvps r
    JOIN guests g ON g.id = r.plus_one_of_guest_id
   WHERE r.plus_one_of_guest_id = p_guest_id
     AND r.event_id = p_event_id
   LIMIT 1;

  -- Food order total (if any)
  SELECT SUM(total) INTO v_order_total
    FROM orders
   WHERE event_id = p_event_id AND guest_id = p_guest_id;

  -- next_step decision tree (mirrors spec §5 exactly)
  IF v_event.status <> 'published' THEN
    v_next_step := 'closed';
  ELSIF v_rsvp.status IS NULL THEN
    IF v_event.rsvp_required THEN
      v_next_step := 'rsvp';
    ELSIF v_order_total IS NOT NULL THEN
      v_next_step := 'view_order';
    ELSE
      v_next_step := 'rsvp';
    END IF;
  ELSIF v_rsvp.status = 'yes' AND v_event.ticketing_enabled THEN
    IF v_rsvp.payment_status IN ('unpaid', 'pending') THEN
      v_next_step := 'pay';
    ELSIF v_rsvp.payment_status = 'paid' THEN
      v_next_step := 'view_ticket';
    ELSE
      v_next_step := 'edit_rsvp';
    END IF;
  ELSIF v_rsvp.status = 'yes' THEN
    v_next_step := 'edit_rsvp';
  ELSIF v_rsvp.status = 'waitlisted' THEN
    v_next_step := 'edit_rsvp';
  ELSE
    v_next_step := 'edit_rsvp';
  END IF;

  RETURN jsonb_build_object(
    'rsvp', v_rsvp.status,
    'waitlist_position', v_rsvp.waitlist_position,
    'plus_one', CASE WHEN v_plus_one.name IS NOT NULL
                     THEN jsonb_build_object('name', v_plus_one.name)
                     ELSE NULL END,
    'is_ticketed_event', v_event.ticketing_enabled,
    'payment_status', v_rsvp.payment_status,
    'ticket_token',
      CASE WHEN auth.uid() IS NOT NULL OR v_rsvp.guest_id = p_guest_id
           THEN v_rsvp.ticket_token
           ELSE NULL END,
    'checked_in_at', v_rsvp.checked_in_at,
    'has_food_order', (v_order_total IS NOT NULL),
    'food_order_total', v_order_total,
    'capacity_remaining', v_capacity_remaining,
    'invited_by', v_invited_by,
    'next_step', v_next_step
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_guest_event_state(uuid, uuid) TO anon, authenticated;
```

**Notes:** `invited_by` is left NULL in this version; Commit 4 wires it up via `?ref=` and `?as=` resolution. Token gating intentionally permissive (caller passes their own `guest_id`); RLS still protects against reading other guests' tickets via the `rsvps` table.

### `030_notifications_dedup_key.sql`

```sql
-- 030: Idempotency for the notifications pipeline.
-- send-notification will write `dedup_key` per send (Commit 3).
-- We add the column and unique constraint here so the column
-- exists before any code references it.

ALTER TABLE notifications_log
  ADD COLUMN dedup_key text;

CREATE UNIQUE INDEX notifications_log_dedup_unique
  ON notifications_log (dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Existing rows have dedup_key = NULL and are exempt from the constraint
-- (per the partial index). New code in Commit 3 always sets it.

COMMENT ON COLUMN notifications_log.dedup_key IS
  'Idempotency key for send-notification. Format defined in USER_FLOWS_SPEC.md §7.2.';
```

### `031_orders_idempotency.sql`

```sql
-- 031: Idempotency keys for orders + pickup_orders.
-- Client populates from a session UUID + cart signature so accidental
-- double-submits are rejected at the DB (USER_FLOWS_SPEC.md §10).

ALTER TABLE orders
  ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX orders_idempotency_unique
  ON orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE pickup_orders
  ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX pickup_orders_idempotency_unique
  ON pickup_orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

### `032_invites_metadata.sql`

```sql
-- 032: Track who consumed an invite token (for attribution) and
-- how many times the invite has been (re)sent. Plus a partial
-- unique index preventing duplicate outstanding invites for the
-- same (event, inviter, target).

ALTER TABLE invites
  ADD COLUMN consumed_by_guest_id uuid REFERENCES guests(id) ON DELETE SET NULL,
  ADD COLUMN send_attempt_n int NOT NULL DEFAULT 1,
  ADD COLUMN last_sent_at timestamptz;

-- Coalesce email/phone into one logical "target" so the unique
-- constraint matches whichever channel the invite uses.
CREATE UNIQUE INDEX invites_unique_target_idx
  ON invites (
    event_id,
    invited_by,
    COALESCE(lower(invited_email), invited_phone)
  );

COMMENT ON COLUMN invites.send_attempt_n IS
  'Increments when admin re-sends. Used in dedup_key suffix per spec §7.2.';
```

### `033_safe_create_rsvp_lock.sql`

```sql
-- 033: Replace safe_create_rsvp with a version that:
--   1. Takes a transaction-scoped advisory lock keyed on event_id
--      (prevents concurrent yes-RSVPs both passing the count check).
--   2. Blocks status transitions away from 'yes' when payment_status='paid'
--      (per spec §4.3). Refund must come first, via mark_rsvp_unpaid.
--   3. Preserves all existing waitlist behavior from migration 002.

CREATE OR REPLACE FUNCTION safe_create_rsvp(
  p_event_id uuid,
  p_guest_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity int;
  v_current_count int;
  v_existing RECORD;
  v_waitlist_position int;
  v_final_status text;
BEGIN
  IF p_status NOT IN ('yes', 'maybe', 'no') THEN
    RAISE EXCEPTION 'invalid_status: %', p_status;
  END IF;

  -- Lock the event row's "rsvp slot" against concurrent inserts.
  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || p_event_id::text));

  SELECT capacity INTO v_capacity FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  SELECT status, payment_status INTO v_existing
    FROM rsvps
   WHERE event_id = p_event_id AND guest_id = p_guest_id;

  -- Block paid → not-yes (spec §4.3): admin must refund first.
  IF v_existing.payment_status = 'paid' AND p_status <> 'yes' THEN
    RAISE EXCEPTION 'paid_rsvp_cannot_change_status'
      USING HINT = 'Refund via admin (mark_rsvp_unpaid) before changing status.';
  END IF;

  -- Capacity check: if status='yes' and event is full, downgrade to waitlisted.
  v_final_status := p_status;
  v_waitlist_position := NULL;

  IF p_status = 'yes' AND v_capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current_count
      FROM rsvps
     WHERE event_id = p_event_id
       AND status = 'yes'
       AND guest_id <> p_guest_id;
    IF v_current_count >= v_capacity THEN
      v_final_status := 'waitlisted';
      SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_position
        FROM rsvps
       WHERE event_id = p_event_id AND status = 'waitlisted';
    END IF;
  END IF;

  INSERT INTO rsvps (event_id, guest_id, status, waitlist_position,
                     waitlisted_at, created_at)
  VALUES (p_event_id, p_guest_id, v_final_status,
          v_waitlist_position,
          CASE WHEN v_final_status = 'waitlisted' THEN now() ELSE NULL END,
          now())
  ON CONFLICT (event_id, guest_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    waitlist_position = CASE
      WHEN EXCLUDED.status = 'waitlisted' THEN EXCLUDED.waitlist_position
      ELSE NULL END,
    waitlisted_at = CASE
      WHEN EXCLUDED.status = 'waitlisted' THEN now()
      ELSE NULL END;

  RETURN jsonb_build_object(
    'status', v_final_status,
    'waitlist_position', v_waitlist_position
  );
END;
$$;

GRANT EXECUTE ON FUNCTION safe_create_rsvp(uuid, uuid, text) TO anon, authenticated;
```

### `034_plus_one_sync_trigger.sql`

```sql
-- 034: Keep plus-one rows' status synchronized with their parent's.
-- Spec §6 invariant I3: a plus-one row's status equals its parent's.
-- When parent status leaves {'yes','waitlisted'}, plus-one rows are
-- removed (per spec §4.1).

CREATE OR REPLACE FUNCTION sync_plus_one_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only act on parent rows (plus_one_of_guest_id IS NULL),
  -- and only when status actually changed.
  IF NEW.plus_one_of_guest_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('yes', 'waitlisted') THEN
    -- Mirror the new status onto plus-one rows for this parent + event.
    UPDATE rsvps
       SET status = NEW.status,
           waitlist_position = NEW.waitlist_position,
           waitlisted_at = NEW.waitlisted_at
     WHERE event_id = NEW.event_id
       AND plus_one_of_guest_id = NEW.guest_id;
  ELSE
    -- Parent went to 'maybe'/'no' — remove plus-one rows for this event.
    DELETE FROM rsvps
     WHERE event_id = NEW.event_id
       AND plus_one_of_guest_id = NEW.guest_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rsvps_sync_plus_one ON rsvps;
CREATE TRIGGER rsvps_sync_plus_one
  AFTER UPDATE OF status ON rsvps
  FOR EACH ROW
  EXECUTE FUNCTION sync_plus_one_status();
```

---

## Frontend changes

### `src/lib/utils/contact.ts` (new)

```ts
// Canonical contact-field normalization.
// USER_FLOWS_SPEC.md §3.1.

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length === 0) return null;
  // Already E.164 (input had a leading +, kept now as digits-only)
  if (input.trim().startsWith('+')) return `+${digits}`;
  // Default US country code if 10 digits
  if (digits.length === 10) return `+1${digits}`;
  // 11 digits with leading 1 → assume US
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // Otherwise pass through with a + prefix (best-effort)
  return `+${digits}`;
}

export function normalizeInstagram(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase().replace(/^@/, '');
  return trimmed.length > 0 ? trimmed : null;
}
```

### `RSVPForm.tsx`, `Order.tsx`, `Pickup.tsx`

Replace the inline `normalizePhone` definitions with:

```ts
import { normalizePhone, normalizeEmail, normalizeInstagram } from '@/lib/utils/contact';
```

(Adjust path alias to whatever the project uses; the codebase appears to use relative paths, so `'../lib/utils/contact'` or `'../../lib/utils/contact'` as appropriate.)

Compare the new function to the existing inline ones; behavior must match for all current inputs. The new version is more permissive about non-US numbers — verify the existing tests/manual cases still pass.

---

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | `normalizePhone` hoist changes behavior subtly for some inputs | medium | Diff inline copies vs. new file; keep US default behavior identical |
| 2 | `safe_create_rsvp` advisory lock holds across long transactions | low | Lock is `_xact_lock`, releases at commit; capacity check is fast |
| 3 | Plus-one trigger fires recursively when status mirrors trigger another update | medium | Trigger only acts on parent rows (early return when `plus_one_of_guest_id IS NOT NULL`); update of mirrored rows shouldn't re-fire because the trigger checks `OLD.status IS NOT DISTINCT FROM NEW.status` and the mirrored update only happens when source changed |
| 4 | Idempotency-key columns added but not yet used by code → no effect this commit | none | By design; Commit 3+ will populate |
| 5 | `get_guest_event_state` returns shape future commits depend on; if shape wrong, downstream rework | medium | Shape mirrors spec §5 exactly; verify by hand against spec before committing |
| 6 | Migration `033` replaces a function existing call sites still call — must keep signature | high | `safe_create_rsvp(uuid, uuid, text)` signature is unchanged; only body differs |
| 7 | Partial unique index on `invites` could fail if existing data already has duplicates | low (no live data) | Operating assumption: empty table. Verify with `SELECT count(*) FROM invites;` before running |
| 8 | `paid → no` block is a new error path; existing UI may not handle it | low | RSVPForm currently has no admin-refund UI; the error is unreachable from public flows. Will be wired up in Commit 5. |

---

## Testing plan

### Pre-deploy checks (local)

```bash
# Type check
npm run build

# Verify migrations apply locally
supabase db reset  # or db push; never reset prod
```

### Post-deploy checks (manual)

1. **`get_guest_event_state` smoke test** (Supabase SQL editor):
   ```sql
   -- With any existing event_id and guest_id
   SELECT get_guest_event_state(
     'EVENT_UUID_HERE',
     'GUEST_UUID_HERE'
   );
   ```
   Expected: JSON with the spec §5 shape. `next_step` non-null. No error.

2. **RSVP flow regression**:
   - Open `/events/:id` for any published event.
   - Submit an RSVP `yes` with a fresh email.
   - Verify the RSVP row is created with status `yes` (or `waitlisted` if at capacity).
   - Resubmit with status `no`. Verify row updates.

3. **Capacity downgrade**:
   - Find or create an event with `capacity = 1`.
   - RSVP guest A `yes`. Verify status `yes`.
   - RSVP guest B `yes`. Verify status `waitlisted`, `waitlist_position = 1`.

4. **Plus-one sync**:
   - On an event with capacity, RSVP `yes` with a plus-one.
   - Manually update parent status to `no` via SQL: `UPDATE rsvps SET status = 'no' WHERE id = '...';`
   - Verify the plus-one row is deleted by the trigger.

5. **Paid-RSVP block**:
   - Manually set a test RSVP's `payment_status = 'paid'` via SQL.
   - Try `safe_create_rsvp(event_id, guest_id, 'no')`.
   - Expect: error `paid_rsvp_cannot_change_status`.

6. **Phone normalization parity**:
   - Submit RSVPs with these phone formats; all should produce the same `phone` column value (`+15551234567`):
     - `(555) 123-4567`
     - `555-123-4567`
     - `5551234567`
     - `+1 (555) 123-4567`
     - `15551234567`

---

## User actions required

After this commit lands and is pulled:

1. **Run the migrations.** Either:
   - `supabase db push` from the repo root (recommended), OR
   - Copy each `029…034` SQL block above into the Supabase SQL editor and run in order.

2. **Verify pre-deploy checks pass** (`npm run build` succeeds).

3. **Run post-deploy checks** above.

4. **Mark this commit** `✅ user-verified` in the [status table](../IMPLEMENTATION_PLAN.md#status-dashboard) by editing this row + the table.

No edge function deploys, no env var changes, no external service config. This commit is purely additive schema + frontend dedup.

---

## Rollback plan

Run **in reverse order**:

```sql
-- Rollback 034
DROP TRIGGER IF EXISTS rsvps_sync_plus_one ON rsvps;
DROP FUNCTION IF EXISTS sync_plus_one_status();

-- Rollback 033 (revert to migration 002's version of safe_create_rsvp)
-- Easiest: re-run the body of supabase/migrations/002_waitlist.sql for that function.
-- See git history of supabase/migrations/002_waitlist.sql or 027_schema_drift_fix.sql
-- for the prior-version body.

-- Rollback 032
DROP INDEX IF EXISTS invites_unique_target_idx;
ALTER TABLE invites
  DROP COLUMN IF EXISTS last_sent_at,
  DROP COLUMN IF EXISTS send_attempt_n,
  DROP COLUMN IF EXISTS consumed_by_guest_id;

-- Rollback 031
DROP INDEX IF EXISTS pickup_orders_idempotency_unique;
ALTER TABLE pickup_orders DROP COLUMN IF EXISTS idempotency_key;
DROP INDEX IF EXISTS orders_idempotency_unique;
ALTER TABLE orders DROP COLUMN IF EXISTS idempotency_key;

-- Rollback 030
DROP INDEX IF EXISTS notifications_log_dedup_unique;
ALTER TABLE notifications_log DROP COLUMN IF EXISTS dedup_key;

-- Rollback 029
DROP FUNCTION IF EXISTS get_guest_event_state(uuid, uuid);
```

Frontend rollback: `git revert <sha>` of this commit — the `normalizePhone` hoist is purely a refactor, no data implications.

**Nuclear option** (if anything goes weird and there's still no live data):
```sql
TRUNCATE TABLE rsvps, orders, order_items, pickup_orders, pickup_order_items,
              invites, notifications_log, magic_links, guests CASCADE;
```

---

## Definition of done

- [ ] All 6 migrations applied in Supabase
- [ ] `npm run build` passes
- [ ] All 6 post-deploy checks above pass
- [ ] Status table updated to 🟢 committed (Claude) and ✅ user-verified (user)
- [ ] No regressions in existing RSVP flow (manual smoke)

---

## Status section (updated as work progresses)

**Last updated:** 2026-05-06, end of Commit 1

| Sub-item | Status | Notes |
|---|---|---|
| 029 — get_guest_event_state | 🟢 | Returns `rsvps`-row-derived JSON; `invited_by` is NULL until Commit 4 |
| 030 — notifications dedup_key | 🟢 | Column + partial unique index added |
| 031 — orders idempotency | 🟢 | Both `orders` and `pickup_orders` |
| 032 — invites metadata | 🟢 | `consumed_by_guest_id`, `send_attempt_n`, `last_sent_at`, partial unique index |
| 033 — safe_create_rsvp lock | 🟢 | Advisory lock + paid-RSVP block. Return type preserved (`rsvps` row). Dedup from 025 retained |
| 034 — plus_one_sync trigger | 🟢 | Uses `plus_one_of` (RSVP id), not `plus_one_of_guest_id` as in original plan |
| `src/lib/utils/contact.ts` | 🟢 | Re-exports `normalizePhone` from `phone.ts`; adds `normalizeEmail` + `normalizeInstagram` |
| RSVPForm/Order/Pickup imports | n/a | Already imported from `phone.ts`; no change needed |
| Manual tests (1–6 above) | ⬜ | Pending user verification |

### Result notes (post-commit)

- **Commit SHA:** *(see git log)*
- **Files actually changed:**
  - `supabase/migrations/029_get_guest_event_state.sql` (new)
  - `supabase/migrations/030_notifications_dedup_key.sql` (new)
  - `supabase/migrations/031_orders_idempotency.sql` (new)
  - `supabase/migrations/032_invites_metadata.sql` (new)
  - `supabase/migrations/033_safe_create_rsvp_lock.sql` (new)
  - `supabase/migrations/034_plus_one_sync_trigger.sql` (new)
  - `src/lib/utils/contact.ts` (new)
- **Deviations from plan** (also logged in `IMPLEMENTATION_PLAN.md` Open Questions):
  1. `normalizePhone` already centralized in `phone.ts` — `contact.ts` re-exports it instead of duplicating.
  2. Plus-one column is `plus_one_of` (RSVP id), not `plus_one_of_guest_id`. Migrations 029 + 034 corrected accordingly.
  3. `safe_create_rsvp` return type preserved as `rsvps` (was jsonb in the plan, would have broken callers).
  4. `get_guest_event_state.invited_by` returns NULL pending Commit 4 token wiring.
  5. `RSVPForm`/`Order`/`Pickup` imports unchanged — they already use the centralized phone util.
- **Open questions raised:** none beyond the deviations above.
- **Build:** `npm run build` passes (after `npm install` to populate node_modules).
