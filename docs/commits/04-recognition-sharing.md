# Commit 4 — Recognition & sharing

> **Goal:** ambient `?as=` token-based recognition; "Hi, X · not you?" header on every public page; ShareButton component on confirmation/event/ticket pages; `?ref=` soft attribution; promote `/find-tickets` to "I've been here before" in the header. After this commit, returning guests are recognized silently across devices via notification clicks, and sharing is one tap.

**Status:** 🟢 committed (pending user verification)
**Prerequisites:** Commits 1, 2, 3 ✅ user-verified
**Estimated migration files:** 3 (renumbered to `043`/`044`/`045`)
**SHA on commit:** *(see git log)*
**User-verified:** ⬜ pending

---

## Scope summary

- Migration: `ambient_tokens` table for long-lived (90-day) recognition tokens.
- Migration: `rsvps.referred_by_guest_id` column for soft attribution from `?ref=` URLs.
- Migration: extend `merge_guests` to include `ambient_tokens` in the FK reassignment list.
- Edge function update: `send-notification` mints an ambient token per guest per send and appends `?as=<token>` to every link in the rendered body.
- Edge function: new `resolve-ambient-token` RPC (or extend an existing one) so the page can swap a `?as=` token for a guest_id.
- Frontend: new `<AmbientTokenHandler>` component runs in `PublicLayout` on mount — reads `?as=`, calls resolve, sets localStorage, strips param via `history.replaceState`.
- Frontend: new `<RecognitionHeader>` component — "Hi, Lina · not you?".
- Frontend: new `<ShareButton>` component — `navigator.share()` on mobile, popover on desktop.
- Frontend: promote `/find-tickets` link to public layout header; rename to "I've been here before".
- Frontend: `RSVPForm` reads `?ref=` from URL, passes to `safe_create_rsvp`.

---

## Files added / modified / deleted

### New

- `supabase/migrations/042_ambient_tokens.sql`
- `supabase/migrations/043_rsvps_referred_by.sql`
- `supabase/migrations/044_merge_guests_ambient.sql` (re-issues `merge_guests` to include the new table)
- `src/components/layout/AmbientTokenHandler.tsx`
- `src/components/layout/RecognitionHeader.tsx`
- `src/components/ui/ShareButton.tsx`
- `src/lib/identity/getMyGuest.ts` (small helper hook over the existing `get_my_guest` RPC)

### Modified

- `src/components/layout/PublicLayout.tsx` — mount `AmbientTokenHandler` + `RecognitionHeader`
- `src/components/events/RSVPForm.tsx` — read `?ref=`, pass through
- `src/pages/EventDetail.tsx` — render `<ShareButton>` for recognized yes-RSVPs; handle post-RSVP confirmation card with share CTA
- `src/pages/Ticket.tsx` — small "Invite a friend" `<ShareButton>` below QR
- `supabase/functions/send-notification/index.ts` — mint + inject `?as=` per send
- `supabase/migrations/035_merge_guests.sql` is superseded by `044`

---

## Inline migrations

### `042_ambient_tokens.sql`

```sql
-- 042: Ambient identity tokens. Spec §3a.2.
-- Long-lived (90 days), rotated per send. Used as ?as=<token> on links
-- inside transactional notifications. Lookup → guest_id only.
-- NOT a credential for ticket access (that requires the separate ticket_token).

CREATE TABLE ambient_tokens (
  token text PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ambient_tokens_guest_idx ON ambient_tokens (guest_id);
CREATE INDEX ambient_tokens_expires_idx
  ON ambient_tokens (expires_at) WHERE expires_at > now();

ALTER TABLE ambient_tokens ENABLE ROW LEVEL SECURITY;
-- No public policies; RPC-only access.

CREATE OR REPLACE FUNCTION mint_ambient_token(p_guest_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM guests WHERE id = p_guest_id) THEN
    RAISE EXCEPTION 'guest_not_found';
  END IF;

  INSERT INTO ambient_tokens (guest_id) VALUES (p_guest_id)
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_ambient_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record RECORD;
BEGIN
  SELECT a.guest_id, a.expires_at, g.first_name
    INTO v_record
    FROM ambient_tokens a
    JOIN guests g ON g.id = a.guest_id
   WHERE a.token = p_token;

  IF NOT FOUND OR v_record.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'guest_id', v_record.guest_id,
    'first_name', v_record.first_name
  );
END;
$$;

-- mint_ambient_token: edge function only (service role)
GRANT EXECUTE ON FUNCTION mint_ambient_token(uuid) TO service_role;
-- resolve_ambient_token: public, called from PublicLayout on mount
GRANT EXECUTE ON FUNCTION resolve_ambient_token(text) TO anon, authenticated;

-- Cleanup job (manual or via pg_cron if configured):
-- DELETE FROM ambient_tokens WHERE expires_at < now() - interval '7 days';
```

### `043_rsvps_referred_by.sql`

```sql
-- 043: Soft attribution from share URLs (?ref=<inviter_guest_id>).
-- Captured at RSVP creation by the frontend; not editable later.
-- Spec §3a.8.

ALTER TABLE rsvps
  ADD COLUMN referred_by_guest_id uuid REFERENCES guests(id) ON DELETE SET NULL;

CREATE INDEX rsvps_referred_by_idx
  ON rsvps (referred_by_guest_id) WHERE referred_by_guest_id IS NOT NULL;

-- safe_create_rsvp signature is unchanged for backward compat;
-- referred_by is set via a separate optional RPC after create.

CREATE OR REPLACE FUNCTION set_rsvp_referrer(
  p_event_id uuid,
  p_guest_id uuid,
  p_referrer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only set if currently NULL (one-shot, can't be edited later)
  -- and the referrer isn't the same as the guest.
  IF p_referrer_id IS NULL OR p_referrer_id = p_guest_id THEN
    RETURN;
  END IF;

  UPDATE rsvps
     SET referred_by_guest_id = p_referrer_id
   WHERE event_id = p_event_id
     AND guest_id = p_guest_id
     AND referred_by_guest_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION set_rsvp_referrer(uuid, uuid, uuid)
  TO anon, authenticated;
```

### `044_merge_guests_ambient.sql`

```sql
-- 044: Re-issue merge_guests to include ambient_tokens in the FK
-- reassignment list. Otherwise identical to migration 035.

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
    RETURN jsonb_build_object('merged', false, 'reason', 'drop_not_found');
  END IF;

  -- RSVP conflict resolution (same as 035)
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
  DELETE FROM rsvps WHERE id IN (SELECT rsvp_id FROM to_delete);

  -- FK reassignment (extended to include ambient_tokens)
  UPDATE rsvps SET guest_id = p_keep_id WHERE guest_id = p_drop_id;
  UPDATE rsvps SET plus_one_of_guest_id = p_keep_id
   WHERE plus_one_of_guest_id = p_drop_id;
  UPDATE rsvps SET referred_by_guest_id = p_keep_id
   WHERE referred_by_guest_id = p_drop_id;
  UPDATE orders SET guest_id = p_keep_id WHERE guest_id = p_drop_id;
  UPDATE pickup_orders SET guest_id = p_keep_id WHERE guest_id = p_drop_id;
  UPDATE invites SET invited_by = p_keep_id WHERE invited_by = p_drop_id;
  UPDATE invites SET consumed_by_guest_id = p_keep_id
   WHERE consumed_by_guest_id = p_drop_id;
  UPDATE notifications_log SET guest_id = p_keep_id WHERE guest_id = p_drop_id;
  UPDATE magic_links SET guest_id = p_keep_id WHERE guest_id = p_drop_id;
  UPDATE ambient_tokens SET guest_id = p_keep_id WHERE guest_id = p_drop_id;
  UPDATE unsubscribe_log SET guest_id = p_keep_id WHERE guest_id = p_drop_id;

  -- Field merge (same as 035)
  UPDATE guests
     SET email = COALESCE(email, v_drop.email),
         phone = COALESCE(phone, v_drop.phone),
         last_name = COALESCE(last_name, v_drop.last_name),
         instagram = COALESCE(instagram, v_drop.instagram)
   WHERE id = p_keep_id;

  IF v_drop.notification_preference = 'none'
     OR v_keep.notification_preference = 'none' THEN
    UPDATE guests SET notification_preference = 'none' WHERE id = p_keep_id;
  END IF;

  DELETE FROM guests WHERE id = p_drop_id;

  RETURN jsonb_build_object(
    'merged', true,
    'kept', p_keep_id,
    'dropped', p_drop_id
  );
END;
$$;
```

---

## Frontend changes

### `src/components/layout/AmbientTokenHandler.tsx` (new)

```tsx
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

export function AmbientTokenHandler() {
  const [params, setParams] = useSearchParams();
  const asToken = params.get('as');

  useEffect(() => {
    if (!asToken) return;
    (async () => {
      const { data, error } = await supabase.rpc('resolve_ambient_token', {
        p_token: asToken,
      });
      if (!error && data?.ok) {
        localStorage.setItem('guest_id', data.guest_id);
      }
      // Strip the param from the URL regardless of result
      // (failed lookups also should not leave the token visible).
      params.delete('as');
      setParams(params, { replace: true });
    })();
  }, [asToken, params, setParams]);

  return null;
}
```

### `src/lib/identity/getMyGuest.ts` (new)

```ts
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

export type MyGuest = {
  id: string;
  first_name: string | null;
  email: string | null;
  phone: string | null;
  notification_preference: 'sms' | 'email' | 'both' | 'none' | null;
};

export function useMyGuest(): { guest: MyGuest | null; loading: boolean } {
  const [guest, setGuest] = useState<MyGuest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = localStorage.getItem('guest_id');
    if (!id) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase.rpc('get_my_guest', { p_guest_id: id });
      setGuest(data ?? null);
      setLoading(false);
    })();
  }, []);

  return { guest, loading };
}

export function clearMyGuest() {
  localStorage.removeItem('guest_id');
  // Reload to reset any in-memory state
  window.location.reload();
}
```

### `src/components/layout/RecognitionHeader.tsx` (new)

```tsx
import { Link } from 'react-router-dom';
import { useMyGuest, clearMyGuest } from '../../lib/identity/getMyGuest';

export function RecognitionHeader() {
  const { guest, loading } = useMyGuest();
  if (loading) return null;

  if (!guest?.first_name) {
    return (
      <Link to="/find-tickets" className="text-sm underline opacity-70">
        I've been here before
      </Link>
    );
  }

  return (
    <span className="text-sm">
      Hi, {guest.first_name}
      {' · '}
      <button
        type="button"
        onClick={() => {
          if (confirm('Forget this device?')) clearMyGuest();
        }}
        className="underline opacity-70 hover:opacity-100"
      >
        not you?
      </button>
    </span>
  );
}
```

### `src/components/ui/ShareButton.tsx` (new)

```tsx
import { useState } from 'react';

type Props = {
  url: string;
  title: string;
  text: string;
  label?: string;  // default "Share"
};

export function ShareButton({ url, title, text, label = 'Share' }: Props) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    const canShare = typeof navigator !== 'undefined'
      && typeof navigator.share === 'function';
    if (canShare) {
      try { await navigator.share({ url, title, text }); } catch { /* canceled */ }
      return;
    }
    // Desktop fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: open mailto
      window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text + '\n\n' + url)}`;
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="px-4 py-2 rounded-md border border-current"
    >
      {copied ? 'Link copied' : label}
    </button>
  );
}
```

### `PublicLayout.tsx` integration

Wrap the existing layout with the handler and header:

```tsx
<>
  <AmbientTokenHandler />
  <header className="...">
    {/* existing nav */}
    <div className="ml-auto"><RecognitionHeader /></div>
  </header>
  <Outlet />
</>
```

### `RSVPForm` `?ref=` capture

```tsx
import { useSearchParams } from 'react-router-dom';

const [params] = useSearchParams();
const refGuestId = params.get('ref');

// After safe_create_rsvp returns successfully:
if (refGuestId) {
  await supabase.rpc('set_rsvp_referrer', {
    p_event_id: eventId,
    p_guest_id: guestId,
    p_referrer_id: refGuestId,
  });
}
```

### Share button placement (per spec §3a.8)

- **Post-RSVP confirmation card** (in `RSVPForm` success state):
  ```tsx
  <ShareButton
    url={`${window.location.origin}/events/${eventId}?ref=${guestId}`}
    title={event.title}
    text={`I'm going to ${event.title} at Cafe Kadhem — want to join?`}
    label="Tell your friends"
  />
  ```
- **EventDetail header** (only when current user has `rsvp='yes'`): same URL shape, label "Share".
- **Ticket page**: small variant, label "Invite a friend".

### Edge function: send-notification ambient injection

Inside `send-notification/index.ts`:

```ts
// Before rendering the email/SMS body, mint a token for this guest:
const { data: token } = await admin.rpc('mint_ambient_token', {
  p_guest_id: guest.id,
});

// Append ?as=<token> to every link in the body. For email: rewrite href
// attributes that point to your own domain. For SMS: append to the single
// link the body usually contains.

function injectAsToken(url: string, token: string): string {
  const u = new URL(url);
  if (u.host !== SITE_HOST) return url;  // never on third-party links
  u.searchParams.set('as', token);
  return u.toString();
}
```

Templates should run their plain URLs through `injectAsToken` before rendering.

---

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Ambient token in URL gets logged in proxy/CDN logs (privacy) | medium | Strip immediately on page load via `history.replaceState`; document in privacy posture |
| 2 | Forwarded email recognizes recipient as the wrong person | low (acceptable) | Spec §3a.2 documents this as the trust model. ShareButton (§3a.8) makes forwarding rare |
| 3 | `mint_ambient_token` called on every send → table grows unbounded | low | Cleanup query in migration 042 comment; add pg_cron schedule if available |
| 4 | `?as=` param survives in browser back-stack history | medium | `replaceState`, not `pushState`. Verify across Safari/Chrome/Firefox |
| 5 | `?ref=` sets attribution to the sharer, but the sharer might be Lina-on-someone-else's-device (cached wrong guest_id) | low | Acceptable noise; admin can ignore bad attributions in analytics |
| 6 | `ShareButton` `navigator.share` fails silently on iOS PWAs | low | Fallback chain: share → clipboard → mailto |
| 7 | `merge_guests` re-issued in 044 — must run AFTER 042 (ambient_tokens exists) | medium | Migration order enforces this; 044 follows 042 numerically |
| 8 | `RecognitionHeader` `confirm()` dialog feels heavy for a routine action | low | Acceptable for v1; can become a small popover later |
| 9 | `useMyGuest` re-fetches on every layout mount, even when guest_id hasn't changed | low | Query key by guest_id; cache is fine to skip in v1, can add SWR-style cache later |
| 10 | Ambient token lookup endpoint can be hammered to enumerate valid tokens | low | 32-char hex space (~10^38) makes brute-force infeasible; rate-limit at edge fn level if needed |

---

## Testing plan

### SQL tests

```sql
-- TEST 1: Mint and resolve
SELECT mint_ambient_token('<some_guest_id>'); -- → token
SELECT resolve_ambient_token('<token>'); -- → { ok: true, guest_id: ..., first_name: ... }

-- TEST 2: Expired token
UPDATE ambient_tokens SET expires_at = now() - interval '1 day'
 WHERE token = '<token>';
SELECT resolve_ambient_token('<token>'); -- → { ok: false }

-- TEST 3: set_rsvp_referrer
INSERT INTO rsvps (event_id, guest_id, status) VALUES ('<eid>', '<gid>', 'yes');
SELECT set_rsvp_referrer('<eid>', '<gid>', '<other_gid>');
SELECT referred_by_guest_id FROM rsvps WHERE event_id='<eid>' AND guest_id='<gid>';
-- Expected: <other_gid>

-- TEST 4: set_rsvp_referrer is one-shot
SELECT set_rsvp_referrer('<eid>', '<gid>', '<yet_another_gid>');
SELECT referred_by_guest_id FROM rsvps WHERE event_id='<eid>' AND guest_id='<gid>';
-- Expected: still <other_gid> (not overwritten)

-- TEST 5: merge across ambient_tokens
INSERT INTO ambient_tokens (guest_id) VALUES ('<drop_id>');
SELECT merge_guests('<keep_id>', '<drop_id>');
SELECT count(*) FROM ambient_tokens WHERE guest_id = '<keep_id>'; -- includes the migrated token
```

### Manual UI tests

1. **Recognition via `?as=`:**
   - Mint a token for a known guest manually: `SELECT mint_ambient_token('<id>');`
   - Open `https://localhost:5173/?as=<token>` (or prod equivalent).
   - Verify: localStorage has `guest_id` set; URL no longer contains `?as=`; header shows "Hi, X · not you?".

2. **"Not you?" clears state:**
   - Click "not you?". Confirm dialog → Yes.
   - Verify: localStorage cleared; header shows "I've been here before".

3. **Share button on mobile (real device or DevTools mobile emulation with `navigator.share` polyfill):**
   - RSVP yes to an event. On the confirmation card, tap Share.
   - Verify: native sheet appears (real device) OR clipboard copy succeeds (desktop).

4. **Share URL has `?ref=` and no `?as=`:**
   - Inspect the shared URL.
   - Verify: contains `?ref=<your_guest_id>`; does NOT contain `?as=`.

5. **`?ref=` attribution captured:**
   - Open the shared URL in a different browser/incognito.
   - RSVP. Check the new RSVP row: `referred_by_guest_id` should equal the sharer's guest_id.

6. **Notification link recognition:**
   - Trigger an RSVP confirmation (test mode) to a known guest.
   - Receive the email/SMS. Verify the link contains `?as=<token>`.
   - Tap from a fresh browser. Verify localStorage gets set, guest is recognized.

7. **Forwarded email scenario (the rough edge):**
   - Take a real notification email, forward it to a different account.
   - Open it. Verify: header briefly shows the wrong name, then user can click "not you?" to correct.
   - This is expected behavior; document in result notes.

---

## User actions required

1. **Run migrations 042, 043, 044** in order.
2. **Deploy edge functions:**
   ```bash
   supabase functions deploy send-notification --project-ref <ref>
   ```
3. **Set env var** (optional, for cleanup): `AMBIENT_TOKEN_TTL_DAYS=90`.
4. **Run all tests above.**
5. **Mark commit verified.**

---

## Rollback plan

```sql
-- Restore merge_guests to migration 035 version (paste from 035)
-- (or 037-equivalent)

DROP FUNCTION IF EXISTS set_rsvp_referrer(uuid, uuid, uuid);
ALTER TABLE rsvps DROP COLUMN IF EXISTS referred_by_guest_id;

DROP FUNCTION IF EXISTS resolve_ambient_token(text);
DROP FUNCTION IF EXISTS mint_ambient_token(uuid);
DROP TABLE IF EXISTS ambient_tokens;
```

Frontend: `git revert <sha>`.

Edge function: redeploy without ambient injection (or revert to prior SHA's version).

---

## Definition of done

- [ ] Migrations 042, 043, 044 applied
- [ ] send-notification redeployed with ambient injection
- [ ] All 5 SQL tests pass
- [ ] All 7 manual UI tests pass
- [ ] `npm run build` passes
- [ ] Verified on at least one real mobile device (share sheet)

---

## Status section

**Last updated:** 2026-05-06, end of Commit 4

| Sub-item | Status | Notes |
|---|---|---|
| 043 — ambient_tokens table + mint/resolve RPCs | 🟢 | 90-day TTL |
| 044 — rsvps.referred_by_guest_id + set_rsvp_referrer | 🟢 | One-shot (no overwrite) |
| 045 — merge_guests re-issued | 🟢 | Now reassigns referred_by_guest_id + ambient_tokens |
| send-notification ambient injection | 🟢 | injectAmbientToken helper, mint per send, skip off-domain + /verify-merge |
| AmbientTokenHandler | 🟢 | Resolves ?as=, sets localStorage, strips param |
| useMyGuest hook | 🟢 | useSyncExternalStore + GUEST_TOKEN_EVENT |
| RecognitionHeader | 🟢 | "Hi, X · not you?" / "I've been here before" |
| ShareButton | 🟢 | navigator.share / clipboard / mailto fallback |
| PublicLayout integration | 🟢 | AmbientTokenHandler mounted; RecognitionHeader in Header |
| RSVPForm `?ref=` capture | 🟢 | One-shot via set_rsvp_referrer |
| ShareButton placements | 🟢 | RSVPForm confirmation (yes/waitlisted), Ticket page (no ?ref=) |
| Migrations applied | ⬜ | User action |
| Edge function deployed | ⬜ | User action |
| All tests | ⬜ | User action |

### Result notes (post-commit)

- **Files changed:**
  - `supabase/migrations/043_ambient_tokens.sql` (new)
  - `supabase/migrations/044_rsvps_referred_by.sql` (new)
  - `supabase/migrations/045_merge_guests_ambient.sql` (new — re-issues merge_guests)
  - `supabase/functions/send-notification/index.ts` (injectAmbientToken helper + mint per send)
  - `src/components/layout/AmbientTokenHandler.tsx` (new)
  - `src/components/layout/RecognitionHeader.tsx` (new)
  - `src/components/layout/PublicLayout.tsx` (mounts handler)
  - `src/components/layout/Header.tsx` (renders RecognitionHeader)
  - `src/components/ui/ShareButton.tsx` (new)
  - `src/lib/identity/useMyGuest.ts` (new)
  - `src/lib/utils/guest-token.ts` (emits GUEST_TOKEN_EVENT on set/clear)
  - `src/components/events/RSVPForm.tsx` (?ref= capture, ShareButton on confirmation)
  - `src/pages/Ticket.tsx` (ShareButton on ticket page, no ?ref= due to TicketView shape)
- **Deviations** (11 items, see plan Open Questions §"Commit 4 deviations from plan").
- **Build:** `npm run build` passes.
