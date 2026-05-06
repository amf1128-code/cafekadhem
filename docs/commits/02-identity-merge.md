# Commit 2 — Identity merge & reconciliation

> **Goal:** implement spec §3.4 cross-channel reconciliation. After this commit, the identity model is robust against guests who use different channels in different sessions, with auto-merge for unambiguous collisions and verify-then-merge for ambiguous ones.

**Status:** 🟢 committed (pending user verification)
**Prerequisites:** Commit 1 ✅ user-verified
**Estimated migration files:** 3 (renumbered to `036`/`037`/`038` due to Commit 1 hot-fix)
**SHA on commit:** *(see git log)*
**User-verified:** ⬜ pending

---

## Scope summary

- New `merge_guests(keep_id, drop_id)` RPC that reassigns FKs from one guest row to another and deletes the dropped row. The single most data-sensitive primitive in the codebase.
- New `merge_verifications` table + `request_merge_verification` and `confirm_merge_verification` RPCs for spec §3.4 Case B (single-channel collision against cached `localStorage.guest_id`).
- Replace `upsert_guest` (currently in migration `028`) with a version that detects Case A (dual-channel collision → auto-merge inline) and Case B (single-channel collision against `p_guest_id` argument → return `pending_merge` payload).
- New verification page `/verify-merge?token=…` that calls `confirm_merge_verification` and merges.
- Update `RSVPForm.tsx`, `Order.tsx`, `Pickup.tsx`, `InviteForm.tsx` to handle the `pending_merge` response (show "we sent a verification" toast and continue with the new identity).

---

## Files added / modified / deleted

### New

- `supabase/migrations/035_merge_guests.sql`
- `supabase/migrations/036_merge_verifications.sql`
- `supabase/migrations/037_upsert_guest_collision.sql`
- `src/pages/VerifyMerge.tsx`
- `src/lib/identity/types.ts` — TypeScript types for `pending_merge` shape

### Modified

- `src/components/events/RSVPForm.tsx` — handle `pending_merge` response
- `src/pages/Order.tsx` — same
- `src/pages/Pickup.tsx` — same
- `src/components/guests/InviteForm.tsx` — same
- `src/routes.tsx` — add `/verify-merge` route
- `supabase/functions/send-notification/index.ts` — add `merge_verification` notification type (new send path)

### Deleted

- *(none)* — `028_restore_upsert_guest.sql` stays in git history; `037` overrides the function definition.

---

## Inline migrations

### `035_merge_guests.sql`

```sql
-- 035: merge_guests RPC.
-- Reassigns FKs from drop_id → keep_id, then deletes drop_id.
-- Idempotent: safe to call twice with the same args (drop_id won't exist).
-- USER_FLOWS_SPEC.md §3.4 Case A.

CREATE OR REPLACE FUNCTION merge_guests(
  p_keep_id uuid,
  p_drop_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep RECORD;
  v_drop RECORD;
  v_conflict_rsvp_count int;
  v_status_rank jsonb := '{"paid":5,"yes":4,"waitlisted":3,"maybe":2,"no":1}';
BEGIN
  IF p_keep_id = p_drop_id THEN
    RETURN jsonb_build_object('merged', false, 'reason', 'same_id');
  END IF;

  SELECT * INTO v_keep FROM guests WHERE id = p_keep_id;
  SELECT * INTO v_drop FROM guests WHERE id = p_drop_id;

  IF v_keep IS NULL THEN
    RAISE EXCEPTION 'merge_guests: keep_id % not found', p_keep_id;
  END IF;

  IF v_drop IS NULL THEN
    -- Already merged or never existed → idempotent no-op
    RETURN jsonb_build_object('merged', false, 'reason', 'drop_not_found');
  END IF;

  -- ============================================================
  -- 1. Resolve RSVP conflicts: if both rows have an RSVP for the
  --    same event, keep the higher-ranked status, drop the other.
  -- ============================================================
  WITH conflicts AS (
    SELECT k.id AS keep_rsvp_id, d.id AS drop_rsvp_id,
           k.status AS keep_status, d.status AS drop_status,
           k.payment_status AS keep_payment, d.payment_status AS drop_payment,
           k.event_id
      FROM rsvps k
      JOIN rsvps d
        ON d.event_id = k.event_id
       AND d.guest_id = p_drop_id
       AND k.guest_id = p_keep_id
  ),
  ranked AS (
    SELECT *,
           CASE WHEN keep_payment = 'paid' THEN 5
                ELSE (v_status_rank->>keep_status)::int END AS keep_rank,
           CASE WHEN drop_payment = 'paid' THEN 5
                ELSE (v_status_rank->>drop_status)::int END AS drop_rank
      FROM conflicts
  ),
  to_delete AS (
    SELECT CASE WHEN keep_rank >= drop_rank THEN drop_rsvp_id
                ELSE keep_rsvp_id END AS rsvp_id
      FROM ranked
  )
  DELETE FROM rsvps
   WHERE id IN (SELECT rsvp_id FROM to_delete);

  -- ============================================================
  -- 2. Reassign all FKs from drop → keep (after conflict resolution).
  -- ============================================================
  UPDATE rsvps SET guest_id = p_keep_id WHERE guest_id = p_drop_id;
  UPDATE rsvps SET plus_one_of_guest_id = p_keep_id
   WHERE plus_one_of_guest_id = p_drop_id;
  UPDATE orders SET guest_id = p_keep_id WHERE guest_id = p_drop_id;
  UPDATE pickup_orders SET guest_id = p_keep_id WHERE guest_id = p_drop_id;
  UPDATE invites SET invited_by = p_keep_id WHERE invited_by = p_drop_id;
  UPDATE invites SET consumed_by_guest_id = p_keep_id
   WHERE consumed_by_guest_id = p_drop_id;
  UPDATE notifications_log SET guest_id = p_keep_id
   WHERE guest_id = p_drop_id;
  UPDATE magic_links SET guest_id = p_keep_id WHERE guest_id = p_drop_id;
  -- ambient_tokens table is added in Commit 4; the merge function will
  -- be re-issued there to include it. For now, no-op on missing table.

  -- ============================================================
  -- 3. Field merge: copy non-null drop fields where keep has null.
  --    Preserves the most-recent submission's identity (which the
  --    caller has already written into keep, so this only fills gaps).
  -- ============================================================
  UPDATE guests
     SET email = COALESCE(email, v_drop.email),
         phone = COALESCE(phone, v_drop.phone),
         last_name = COALESCE(last_name, v_drop.last_name),
         instagram = COALESCE(instagram, v_drop.instagram)
   WHERE id = p_keep_id;

  -- ============================================================
  -- 4. Suppression is sticky: if either row had 'none', merged is 'none'.
  -- ============================================================
  IF v_drop.notification_preference = 'none'
     OR v_keep.notification_preference = 'none' THEN
    UPDATE guests SET notification_preference = 'none' WHERE id = p_keep_id;
  END IF;

  -- ============================================================
  -- 5. Drop the merged row. FK CASCADE/SET NULL handles anything
  --    we missed; if a constraint trips, the whole TX rolls back
  --    and the merge is aborted (caller sees the error).
  -- ============================================================
  DELETE FROM guests WHERE id = p_drop_id;

  RETURN jsonb_build_object(
    'merged', true,
    'kept', p_keep_id,
    'dropped', p_drop_id
  );
END;
$$;

-- Grant only to authenticated (admin) and to upsert_guest's SECURITY DEFINER
-- context. Anonymous callers cannot merge directly.
GRANT EXECUTE ON FUNCTION merge_guests(uuid, uuid) TO authenticated;
```

### `036_merge_verifications.sql`

```sql
-- 036: Verify-then-merge tokens for spec §3.4 Case B.
-- A merge verification is created when upsert_guest detects a
-- single-channel collision against the caller's cached guest_id.
-- Tap the link → confirm_merge_verification → merge_guests fires.

CREATE TABLE merge_verifications (
  token text PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  keep_guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  drop_guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX merge_verifications_expires_at_idx
  ON merge_verifications (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE merge_verifications ENABLE ROW LEVEL SECURITY;
-- No anon SELECT/INSERT — handled exclusively through RPCs below.

CREATE OR REPLACE FUNCTION request_merge_verification(
  p_keep_id uuid,
  p_drop_id uuid,
  p_channel text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  IF p_channel NOT IN ('email', 'sms') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;

  -- Ensure both rows exist before issuing
  IF NOT EXISTS (SELECT 1 FROM guests WHERE id = p_keep_id)
     OR NOT EXISTS (SELECT 1 FROM guests WHERE id = p_drop_id) THEN
    RAISE EXCEPTION 'guest_not_found';
  END IF;

  INSERT INTO merge_verifications (keep_guest_id, drop_guest_id, channel)
  VALUES (p_keep_id, p_drop_id, p_channel)
  RETURNING token INTO v_token;

  RETURN jsonb_build_object('token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION confirm_merge_verification(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record RECORD;
  v_merge_result jsonb;
BEGIN
  SELECT * INTO v_record
    FROM merge_verifications
   WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;

  IF v_record.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_consumed');
  END IF;

  IF v_record.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  v_merge_result := merge_guests(v_record.keep_guest_id, v_record.drop_guest_id);

  UPDATE merge_verifications
     SET consumed_at = now()
   WHERE token = p_token;

  RETURN jsonb_build_object(
    'ok', true,
    'guest_id', v_record.keep_guest_id,
    'merge', v_merge_result
  );
END;
$$;

GRANT EXECUTE ON FUNCTION request_merge_verification(uuid, uuid, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_merge_verification(text)
  TO anon, authenticated;
```

### `037_upsert_guest_collision.sql`

```sql
-- 037: Replace upsert_guest with a version that detects:
--   Case A: both email and phone provided, mapping to two different
--           existing rows → auto-merge inline.
--   Case B: single channel matches an existing row that differs from
--           the caller's p_guest_id → return pending_merge (caller
--           triggers verification flow, no row mutation yet).
--   Case C: no collision → existing behavior (matches/inserts as before).
--
-- Returns: { id: uuid, pending_merge: { from, to, channel } | null }
-- USER_FLOWS_SPEC.md §3.4.

CREATE OR REPLACE FUNCTION upsert_guest(
  p_fields jsonb,
  p_guest_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_phone text;
  v_first_name text;
  v_pref text;
  v_id uuid;
  v_email_match uuid;
  v_phone_match uuid;
  v_keep uuid;
  v_drop uuid;
  v_pending_merge jsonb := NULL;
BEGIN
  v_email := NULLIF(lower(trim(p_fields->>'email')), '');
  v_phone := NULLIF(p_fields->>'phone', '');
  v_first_name := NULLIF(trim(p_fields->>'first_name'), '');
  v_pref := NULLIF(p_fields->>'notification_preference', '');

  -- Validate: at least one channel OR an explicit p_guest_id (for plus-ones)
  IF v_email IS NULL AND v_phone IS NULL AND p_guest_id IS NULL THEN
    RAISE EXCEPTION 'contact_required';
  END IF;

  IF v_pref IS NOT NULL AND v_pref NOT IN ('sms', 'email', 'both', 'none') THEN
    RAISE EXCEPTION 'invalid_notification_preference: %', v_pref;
  END IF;

  -- ============================================================
  -- Path 1: explicit p_guest_id → update by id (no collision check)
  -- ============================================================
  IF p_guest_id IS NOT NULL THEN
    UPDATE guests
       SET first_name = COALESCE(v_first_name, first_name),
           last_name = COALESCE(NULLIF(p_fields->>'last_name', ''), last_name),
           email = COALESCE(v_email, email),
           phone = COALESCE(v_phone, phone),
           instagram = COALESCE(NULLIF(p_fields->>'instagram', ''), instagram),
           notification_preference = COALESCE(v_pref, notification_preference)
     WHERE id = p_guest_id
     RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_id, 'pending_merge', NULL);
    END IF;
    -- p_guest_id was stale (deleted) — fall through to dedup paths
  END IF;

  -- ============================================================
  -- Look up existing rows for each channel
  -- ============================================================
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_email_match
      FROM guests
     WHERE lower(email) = v_email
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_phone_match
      FROM guests
     WHERE phone = v_phone
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  -- ============================================================
  -- Case A: dual-channel collision → auto-merge
  -- Both channels resolve to existing rows, and they differ.
  -- ============================================================
  IF v_email_match IS NOT NULL
     AND v_phone_match IS NOT NULL
     AND v_email_match <> v_phone_match THEN
    -- Older row wins
    SELECT
      CASE WHEN ge.created_at <= gp.created_at THEN ge.id ELSE gp.id END,
      CASE WHEN ge.created_at <= gp.created_at THEN gp.id ELSE ge.id END
      INTO v_keep, v_drop
      FROM guests ge, guests gp
     WHERE ge.id = v_email_match AND gp.id = v_phone_match;

    -- Update kept row with latest fields BEFORE merging
    UPDATE guests
       SET first_name = COALESCE(v_first_name, first_name),
           last_name = COALESCE(NULLIF(p_fields->>'last_name', ''), last_name),
           email = COALESCE(v_email, email),
           phone = COALESCE(v_phone, phone),
           instagram = COALESCE(NULLIF(p_fields->>'instagram', ''), instagram),
           notification_preference = COALESCE(v_pref, notification_preference)
     WHERE id = v_keep;

    PERFORM merge_guests(v_keep, v_drop);

    RETURN jsonb_build_object('id', v_keep, 'pending_merge', NULL);
  END IF;

  -- ============================================================
  -- Case B: single-channel collision against cached p_guest_id
  -- Caller's localStorage said guest X, but the channel they typed
  -- matches a different existing row Y. Return pending_merge.
  -- ============================================================
  IF p_guest_id IS NOT NULL THEN
    IF v_email_match IS NOT NULL AND v_email_match <> p_guest_id THEN
      v_pending_merge := jsonb_build_object(
        'from', p_guest_id, 'to', v_email_match, 'channel', 'email'
      );
      v_id := v_email_match;  -- Caller is identified as the email match for this submission
    ELSIF v_phone_match IS NOT NULL AND v_phone_match <> p_guest_id THEN
      v_pending_merge := jsonb_build_object(
        'from', p_guest_id, 'to', v_phone_match, 'channel', 'sms'
      );
      v_id := v_phone_match;
    END IF;
  END IF;

  -- ============================================================
  -- Case C / default: no collision (or only one channel matched
  -- and there's no cached p_guest_id to conflict with)
  -- ============================================================
  IF v_id IS NULL THEN
    v_id := COALESCE(v_email_match, v_phone_match);
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE guests
       SET first_name = COALESCE(v_first_name, first_name),
           last_name = COALESCE(NULLIF(p_fields->>'last_name', ''), last_name),
           email = COALESCE(v_email, email),
           phone = COALESCE(v_phone, phone),
           instagram = COALESCE(NULLIF(p_fields->>'instagram', ''), instagram),
           notification_preference = COALESCE(v_pref, notification_preference)
     WHERE id = v_id;
  ELSE
    -- Insert
    IF v_first_name IS NULL THEN
      RAISE EXCEPTION 'first_name_required';
    END IF;
    INSERT INTO guests (first_name, last_name, email, phone, instagram,
                        notification_preference)
    VALUES (
      v_first_name,
      NULLIF(p_fields->>'last_name', ''),
      v_email,
      v_phone,
      NULLIF(p_fields->>'instagram', ''),
      COALESCE(v_pref, 'email')
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'pending_merge', v_pending_merge);
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_guest(jsonb, uuid) TO anon, authenticated;
```

---

## Frontend changes

### `src/lib/identity/types.ts` (new)

```ts
// Shape of the upsert_guest response post-Commit 2.
// USER_FLOWS_SPEC.md §3.4.

export type PendingMerge = {
  from: string;     // guest_id stale in localStorage
  to: string;       // guest_id the channel resolves to
  channel: 'email' | 'sms';
};

export type UpsertGuestResult = {
  id: string;
  pending_merge: PendingMerge | null;
};
```

### `src/pages/VerifyMerge.tsx` (new)

```tsx
// Route: /verify-merge?token=...
// Calls confirm_merge_verification, sets localStorage.guest_id,
// redirects to /my-tickets on success.

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function VerifyMerge() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError('missing_token'); return; }
    (async () => {
      const { data, error } = await supabase.rpc('confirm_merge_verification', {
        p_token: token,
      });
      if (error) { setError(error.message); return; }
      if (data?.ok) {
        localStorage.setItem('guest_id', data.guest_id);
        navigate('/my-tickets', { replace: true });
      } else {
        setError(data?.reason ?? 'unknown');
      }
    })();
  }, [token, navigate]);

  if (error) {
    return (
      <div className="p-8 text-center">
        <p>This verification link is no longer valid.</p>
        <p className="mt-2 text-sm opacity-60">Reason: {error}</p>
        <a href="/find-tickets" className="underline mt-4 inline-block">
          Try again
        </a>
      </div>
    );
  }
  return <div className="p-8 text-center">Verifying…</div>;
}
```

### Form handler updates (RSVPForm, Order, Pickup, InviteForm)

Pseudocode for each form's submit path:

```ts
const { data, error } = await supabase.rpc('upsert_guest', {
  p_fields: { first_name, email, phone, /* ... */ },
  p_guest_id: localStorage.getItem('guest_id'),
});
if (error) { /* handle */ }

if (data.pending_merge) {
  // Fire merge verification asynchronously; don't block the user
  await supabase.functions.invoke('send-notification', {
    body: {
      guestId: data.pending_merge.to,
      type: 'merge_verification',
      data: {
        from: data.pending_merge.from,
        to: data.pending_merge.to,
        channel: data.pending_merge.channel,
      },
    },
  });
  toast(`We sent a verification ${data.pending_merge.channel === 'email' ? 'email' : 'text'} to confirm this is your account.`);
}

localStorage.setItem('guest_id', data.id);
// Continue with the submitted action (RSVP, order, etc.) using data.id
```

### `supabase/functions/send-notification/index.ts` — add merge_verification type

The send-notification fn (rewritten in Commit 3) needs a new type handler. For Commit 2, add minimal support:

```ts
// In send-notification's type switch:
case 'merge_verification': {
  const { data: token } = await supabase.rpc('request_merge_verification', {
    p_keep_id: payload.data.to,
    p_drop_id: payload.data.from,
    p_channel: payload.data.channel,
  });
  const url = `${SITE_URL}/verify-merge?token=${token.token}`;
  // send email or SMS with this URL via existing channel logic
  break;
}
```

### `src/routes.tsx` — add route

```tsx
const VerifyMerge = lazy(() =>
  import('./pages/VerifyMerge').then(m => ({ default: m.VerifyMerge }))
);

// inside the public layout children:
{ path: 'verify-merge', element: <VerifyMerge /> },
```

---

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | `merge_guests` deletes wrong row (keep/drop swapped) | **critical** | Older-row-wins logic verified in unit-style tests below; idempotent on missing drop |
| 2 | Concurrent dual-channel submits cause two simultaneous merges | medium | Each merge runs in its own tx; the second observes drop already gone and no-ops |
| 3 | RSVP-conflict resolution (both rows have RSVP for same event) drops a paid ticket | high | Status rank explicitly puts `payment_status='paid'` at rank 5, above `yes` at 4 |
| 4 | A merge_verification token leaks (forwarded email) → attacker triggers merge | medium | Token is single-use, 30-min TTL, sent only to the channel that owns the target row. Worst case: attacker merges two of their own rows |
| 5 | `confirm_merge_verification` runs `merge_guests` even if intervening writes happened | medium | Acceptable: merge is field-additive (COALESCE) and FK-safe. New writes to drop_id between request and confirm are also reassigned |
| 6 | Spec §3.4 Case A says "older row wins" but doesn't define ties | low | Tie-break: `ge.id = v_email_match` arbitrarily kept. Document in result notes |
| 7 | `upsert_guest` body grew significantly; behavior regression possible for non-collision cases | medium | Test plan below covers Case C (default) explicitly |
| 8 | merge_guests' UPDATE on `ambient_tokens` not yet present (table arrives in Commit 4) | low | Migration `035` does NOT reference ambient_tokens; Commit 4 will replace `merge_guests` with a version that does |

---

## Testing plan

### Unit-style migration tests (run in Supabase SQL editor)

```sql
-- TEST 1: merge_guests basic FK reassignment
INSERT INTO guests (first_name, email) VALUES ('A', 'a@test.com') RETURNING id;
-- note → guest_a
INSERT INTO guests (first_name, phone) VALUES ('A', '+15550000001') RETURNING id;
-- note → guest_b

-- create artifacts on guest_b
INSERT INTO rsvps (event_id, guest_id, status)
SELECT id, '<guest_b>', 'yes' FROM events LIMIT 1;

SELECT merge_guests('<guest_a>', '<guest_b>');
-- Expected: { merged: true, kept: <guest_a>, dropped: <guest_b> }

SELECT * FROM rsvps WHERE guest_id = '<guest_a>'; -- should show the migrated RSVP
SELECT * FROM guests WHERE id = '<guest_b>';      -- should be empty

-- TEST 2: Case A auto-merge via upsert_guest
-- Pre-create two split rows; submit a form with both channels.
INSERT INTO guests (first_name, email)
  VALUES ('Lina', 'lina@test.com') RETURNING id; -- → row1
INSERT INTO guests (first_name, phone)
  VALUES ('Lina', '+15550000002') RETURNING id;  -- → row2

SELECT upsert_guest(
  jsonb_build_object(
    'first_name', 'Lina',
    'email', 'lina@test.com',
    'phone', '+15550000002'
  )
);
-- Expected: { id: <older-of-row1-row2>, pending_merge: null }
-- The newer row should be deleted; only one Lina remains.

SELECT count(*) FROM guests
 WHERE email = 'lina@test.com' OR phone = '+15550000002';
-- Expected: 1

-- TEST 3: Case B pending_merge response
INSERT INTO guests (first_name, email)
  VALUES ('Sam', 'sam@test.com') RETURNING id; -- → row_e
INSERT INTO guests (first_name, phone)
  VALUES ('Sam', '+15550000003') RETURNING id; -- → row_p (cached as guest_id)

SELECT upsert_guest(
  jsonb_build_object('first_name', 'Sam', 'email', 'sam@test.com'),
  '<row_p>'  -- p_guest_id pretending to be the cached guest
);
-- Expected: { id: <row_e>, pending_merge: { from: <row_p>, to: <row_e>, channel: 'email' } }

-- TEST 4: paid RSVP conflict resolution
-- Both rows have RSVP for same event; one is paid, one is yes.
-- After merge, paid should win.
-- (set up two guests + events + rsvps + payment_status manually, then merge)

-- TEST 5: idempotency
-- Calling merge twice with the same args should not error.
SELECT merge_guests('<guest_a>', '<nonexistent_uuid>');
-- Expected: { merged: false, reason: 'drop_not_found' }
```

### End-to-end (manual UI)

1. **Case A in the form:**
   - Manually create two guest rows in SQL (one email-only, one phone-only).
   - Open `/events/:id`, RSVP with both channels (matching both pre-existing rows).
   - Verify only one guest row remains; the form pre-fills correctly on next visit.

2. **Case B verification flow:**
   - Cache a `guest_id` in localStorage (`localStorage.setItem('guest_id', '<some_id>')`).
   - On `/events/:id`, type an email matching a *different* existing guest.
   - Submit. Verify a "we sent a verification" toast appears.
   - Receive the email/SMS, tap the link → verify it lands on `/my-tickets` and the merge happened.

3. **Case C (no-op):**
   - Submit a fresh email + phone with no existing matches.
   - Expect a new guest row, no merge, no verification.

4. **Verification expiry:**
   - Trigger Case B, then `UPDATE merge_verifications SET expires_at = now() - interval '1 hour' WHERE token = '<token>';`
   - Tap the link. Expect "no longer valid" page.

---

## User actions required

1. **Run migrations 035, 036, 037** (paste from above or `supabase db push`).
2. **Deploy edge function** (small diff for `merge_verification` case):
   ```bash
   supabase functions deploy send-notification --project-ref <ref>
   ```
3. **Run tests 1–5** above.
4. **Mark commit verified** in the status table once tests pass.

---

## Rollback plan

```sql
-- Restore upsert_guest to the migration 028 version
-- (paste body from supabase/migrations/028_restore_upsert_guest.sql)

-- Drop merge infrastructure
DROP FUNCTION IF EXISTS confirm_merge_verification(text);
DROP FUNCTION IF EXISTS request_merge_verification(uuid, uuid, text);
DROP TABLE IF EXISTS merge_verifications;
DROP FUNCTION IF EXISTS merge_guests(uuid, uuid);
```

Frontend: `git revert <sha>` of this commit.

**If a bad merge happened:** there is no automated un-merge. With no live data, just `TRUNCATE guests CASCADE` and re-test. With live data, restore from backup.

---

## Definition of done

- [ ] Migrations 035, 036, 037 applied
- [ ] send-notification edge fn deployed with `merge_verification` case
- [ ] All 5 SQL tests pass
- [ ] All 4 manual UI tests pass
- [ ] `npm run build` passes
- [ ] Status table updated to 🟢 → ✅

---

## Status section

**Last updated:** 2026-05-06, end of Commit 2

| Sub-item | Status | Notes |
|---|---|---|
| 036 — merge_guests | 🟢 | RSVP conflict resolution (paid > yes > waitlisted > maybe > no); plus-ones cascade via FK |
| 037 — merge_verifications | 🟢 | Token + request/confirm RPCs |
| 038 — upsert_guest collision detection | 🟢 | Return type changed to JSONB to carry `pending_merge`; verification token minted server-side |
| send-notification merge_verification handler | 🟢 | New template + verify_url builder + channel override via `data.channel` |
| `src/pages/VerifyMerge.tsx` | 🟢 | New page; handles success / already_consumed / expired / invalid |
| `src/routes.tsx` route | 🟢 | `/verify-merge` added under PublicLayout |
| Form handler updates | 🟢 | RSVPForm, Order, Pickup all dispatch verification on `pending_merge`. InviteForm doesn't call upsert_guest, no change needed |
| `src/lib/identity/handlePendingMerge.ts` | 🟢 | New helper centralizing the dispatch |
| SQL tests | ⬜ | Pending user verification |
| Manual UI tests | ⬜ | Pending user verification |

### Result notes (post-commit)

- **Commit SHA:** *(see git log)*
- **Migration numbers shifted by 1** (036/037/038 instead of plan's 035/036/037) because Commit 1 hot-fix took the 035 slot.
- **Files actually changed:**
  - `supabase/migrations/036_merge_guests.sql` (new)
  - `supabase/migrations/037_merge_verifications.sql` (new)
  - `supabase/migrations/038_upsert_guest_collision.sql` (new)
  - `supabase/functions/send-notification/index.ts` (added merge_verification template, verify_url builder, channel override)
  - `src/pages/VerifyMerge.tsx` (new)
  - `src/routes.tsx` (route added)
  - `src/lib/identity/handlePendingMerge.ts` (new helper)
  - `src/components/events/RSVPForm.tsx` (pending_merge handler)
  - `src/pages/Order.tsx` (pending_merge handler)
  - `src/pages/Pickup.tsx` (pending_merge handler)
- **Deviations from plan** (logged in `IMPLEMENTATION_PLAN.md` Open Questions):
  1. `upsert_guest` returns JSONB now (was `guests` row).
  2. `verification_token` minted in upsert_guest, not in send-notification.
  3. `request_merge_verification` not granted to anon (only service_role/authenticated). The SECURITY DEFINER context of upsert_guest reaches it for anon callers.
  4. `merge_guests` doesn't touch `rsvps.plus_one_of` (it's an RSVP id, not a guest id).
  5. Channel override added to send-notification.
  6. `'both'` preference deferred to Commit 3.
  7. InviteForm doesn't call upsert_guest directly; no changes needed there.
- **Open questions raised:** none.
- **Build:** `npm run build` passes.
