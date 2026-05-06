# Commit 3 — Notifications hardening

> **Goal:** wire `dedup_key` end-to-end, add per-type channel routing for `'both'`, add the consent note to every public form, drop the channel-preference dropdown, hook up STOP / unsubscribe webhooks, flip `sms_enabled = true` (10DLC approved). After this commit, notifications are idempotent, compliant, and inferred-from-fields.

**Status:** 🟢 committed (pending user verification)
**Prerequisites:** Commits 1 + 2 ✅ user-verified
**Estimated migration files:** 4 (renumbered to `039`/`040`/`041`/`042`)
**SHA on commit:** *(see git log)*
**User-verified:** ⬜ pending

---

## Scope summary

- Migration: extend `notification_preference` to include `'both'`.
- Migration: `unsubscribe_log` table for audit of STOP / unsubscribe events.
- Migration: flip `admin_settings.sms_enabled = true`.
- Edge function: rewrite `send-notification/index.ts` with per-type channel routing, `dedup_key` insertion, suppression check, and signed-link generation (for unsubscribe + verification).
- Edge function: new `webhook-sms/index.ts` for Telnyx STOP / HELP inbound.
- Edge function: new `webhook-email/index.ts` for Resend unsubscribe events.
- Frontend: new `<ConsentNote>` component, copy in `src/lib/notifications/consent.ts`.
- Frontend: remove channel-preference dropdown from `RSVPForm`, `Order`, `Pickup`, `InviteForm`. Preference is inferred at `upsert_guest` time from filled fields (logic added to `upsert_guest` in this commit).

---

## Files added / modified / deleted

### New

- `supabase/migrations/038_notification_preference_both.sql`
- `supabase/migrations/039_unsubscribe_log.sql`
- `supabase/migrations/040_sms_enabled_flip.sql`
- `supabase/migrations/041_upsert_guest_infer_preference.sql` (extends 037 to infer pref from fields)
- `supabase/functions/send-notification/index.ts` (rewrite)
- `supabase/functions/webhook-sms/index.ts` (new)
- `supabase/functions/webhook-email/index.ts` (new)
- `src/lib/notifications/consent.ts` (new)
- `src/components/ui/ConsentNote.tsx` (new)

### Modified

- `src/components/events/RSVPForm.tsx` — remove preference dropdown, add `<ConsentNote>`
- `src/pages/Order.tsx` — same
- `src/pages/Pickup.tsx` — same
- `src/components/guests/InviteForm.tsx` — same
- `src/lib/types.ts` — extend `NotificationPreference` union to include `'both'`

---

## Inline migrations

### `038_notification_preference_both.sql`

```sql
-- 038: Extend notification_preference to include 'both'.
-- The column may have been declared as enum or text+check constraint
-- (depending on prior migration history). Handle both shapes.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'notification_preference'
  ) THEN
    -- Enum type — add value
    ALTER TYPE notification_preference ADD VALUE IF NOT EXISTS 'both';
  ELSE
    -- Likely a CHECK constraint on guests.notification_preference
    ALTER TABLE guests
      DROP CONSTRAINT IF EXISTS guests_notification_preference_check;
    ALTER TABLE guests
      ADD CONSTRAINT guests_notification_preference_check
      CHECK (notification_preference IN ('sms', 'email', 'both', 'none'));
  END IF;
END$$;
```

### `039_unsubscribe_log.sql`

```sql
-- 039: Audit log for inbound STOP / unsubscribe events.
-- Append-only; row insertion sets guests.notification_preference = 'none'.

CREATE TABLE unsubscribe_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms', 'email')),
  source text NOT NULL,  -- 'telnyx_stop', 'resend_unsubscribe', 'admin', 'guest_self'
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX unsubscribe_log_guest_idx ON unsubscribe_log (guest_id);

ALTER TABLE unsubscribe_log ENABLE ROW LEVEL SECURITY;
-- No public policies; admin-only via dashboard.

CREATE OR REPLACE FUNCTION record_unsubscribe(
  p_guest_id uuid,
  p_channel text,
  p_source text,
  p_payload jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO unsubscribe_log (guest_id, channel, source, raw_payload)
  VALUES (p_guest_id, p_channel, p_source, p_payload);

  UPDATE guests
     SET notification_preference = 'none'
   WHERE id = p_guest_id;
END;
$$;

-- Webhook edge functions call this with the service role key.
GRANT EXECUTE ON FUNCTION record_unsubscribe(uuid, text, text, jsonb)
  TO service_role;
```

### `040_sms_enabled_flip.sql`

```sql
-- 040: 10DLC approved (per user, 2026-05). Flip the flag.

UPDATE admin_settings SET sms_enabled = true;
-- If multi-row, scope: ... WHERE id = 1; (verify schema before running)
```

### `041_upsert_guest_infer_preference.sql`

```sql
-- 041: Infer notification_preference from filled fields when not explicitly
-- provided. SMS-default for new guests with both channels (10DLC approved).
-- Replaces the upsert_guest body from migration 037 — the only change is
-- the preference-inference block near the bottom.

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
  v_inferred_pref text;
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

  IF v_email IS NULL AND v_phone IS NULL AND p_guest_id IS NULL THEN
    RAISE EXCEPTION 'contact_required';
  END IF;

  IF v_pref IS NOT NULL AND v_pref NOT IN ('sms', 'email', 'both', 'none') THEN
    RAISE EXCEPTION 'invalid_notification_preference: %', v_pref;
  END IF;

  -- Inferred preference (used only when v_pref IS NULL and we're inserting
  -- a new row, or when the existing row has NULL preference). Spec §7.1.
  v_inferred_pref := CASE
    WHEN v_email IS NOT NULL AND v_phone IS NOT NULL THEN 'both'
    WHEN v_phone IS NOT NULL THEN 'sms'
    WHEN v_email IS NOT NULL THEN 'email'
    ELSE NULL
  END;

  -- Path 1: explicit p_guest_id
  IF p_guest_id IS NOT NULL THEN
    UPDATE guests
       SET first_name = COALESCE(v_first_name, first_name),
           last_name = COALESCE(NULLIF(p_fields->>'last_name', ''), last_name),
           email = COALESCE(v_email, email),
           phone = COALESCE(v_phone, phone),
           instagram = COALESCE(NULLIF(p_fields->>'instagram', ''), instagram),
           notification_preference = COALESCE(
             v_pref,                          -- explicit user override
             notification_preference,         -- existing preference
             v_inferred_pref                  -- inferred only if both are null
           )
     WHERE id = p_guest_id
     RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_id, 'pending_merge', NULL);
    END IF;
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT id INTO v_email_match FROM guests
     WHERE lower(email) = v_email ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_phone_match FROM guests
     WHERE phone = v_phone ORDER BY created_at DESC LIMIT 1;
  END IF;

  -- Case A: dual-channel collision → auto-merge
  IF v_email_match IS NOT NULL AND v_phone_match IS NOT NULL
     AND v_email_match <> v_phone_match THEN
    SELECT
      CASE WHEN ge.created_at <= gp.created_at THEN ge.id ELSE gp.id END,
      CASE WHEN ge.created_at <= gp.created_at THEN gp.id ELSE ge.id END
      INTO v_keep, v_drop
      FROM guests ge, guests gp
     WHERE ge.id = v_email_match AND gp.id = v_phone_match;

    UPDATE guests
       SET first_name = COALESCE(v_first_name, first_name),
           last_name = COALESCE(NULLIF(p_fields->>'last_name', ''), last_name),
           email = COALESCE(v_email, email),
           phone = COALESCE(v_phone, phone),
           instagram = COALESCE(NULLIF(p_fields->>'instagram', ''), instagram),
           notification_preference = COALESCE(
             v_pref, notification_preference, v_inferred_pref
           )
     WHERE id = v_keep;

    PERFORM merge_guests(v_keep, v_drop);
    RETURN jsonb_build_object('id', v_keep, 'pending_merge', NULL);
  END IF;

  -- Case B: single-channel collision against cached p_guest_id
  IF p_guest_id IS NOT NULL THEN
    IF v_email_match IS NOT NULL AND v_email_match <> p_guest_id THEN
      v_pending_merge := jsonb_build_object(
        'from', p_guest_id, 'to', v_email_match, 'channel', 'email'
      );
      v_id := v_email_match;
    ELSIF v_phone_match IS NOT NULL AND v_phone_match <> p_guest_id THEN
      v_pending_merge := jsonb_build_object(
        'from', p_guest_id, 'to', v_phone_match, 'channel', 'sms'
      );
      v_id := v_phone_match;
    END IF;
  END IF;

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
           notification_preference = COALESCE(
             v_pref, notification_preference, v_inferred_pref
           )
     WHERE id = v_id;
  ELSE
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
      COALESCE(v_pref, v_inferred_pref, 'email')
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'pending_merge', v_pending_merge);
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_guest(jsonb, uuid) TO anon, authenticated;
```

---

## Edge function rewrites

### `supabase/functions/send-notification/index.ts`

Skeleton (full file too large for inline; key responsibilities below):

```ts
// Per spec §7. Responsibilities:
// 1. Resolve guest by guestId.
// 2. Compute dedup_key per the type-specific bucket scheme (§7.2).
// 3. INSERT INTO notifications_log (..., dedup_key) ON CONFLICT DO NOTHING
//    RETURNING id. If no row returned → skip send (already delivered).
// 4. Resolve channel using preference + sms_enabled + per-type routing table.
// 5. If preference='none', mark row 'suppressed' and return.
// 6. Render template (templates in src/lib/notifications/templates/* exposed
//    as a Deno-importable shared module).
// 7. Send via Telnyx (SMS) or Resend (email).
// 8. Update notifications_log with status (sent/failed) + provider response.

const TYPE_CHANNEL_PREFERENCE_BOTH: Record<string, 'sms' | 'email'> = {
  rsvp_confirmation: 'sms',
  ticket_issued: 'sms',
  invite: 'sms',
  event_reminder: 'sms',
  waitlist_promoted: 'sms',
  order_confirmation: 'email',
  pickup_order_confirmation: 'email',
  event_update: 'email',
  merge_verification: 'email',  // verification matches the channel passed; this is the override default
};

function dedupKey(type: string, guestId: string, eventId: string | null, bucket: string): string {
  return `${type}:${guestId}:${eventId ?? 'null'}:${bucket}`;
}

function resolveChannel(
  pref: 'sms' | 'email' | 'both' | 'none',
  smsEnabled: boolean,
  type: string,
  guest: { email: string | null; phone: string | null },
  channelOverride?: 'sms' | 'email',
): 'sms' | 'email' | 'suppressed' {
  if (pref === 'none') return 'suppressed';
  if (channelOverride) {
    // For merge_verification: must use the channel that owns the row
    if (channelOverride === 'sms' && (!smsEnabled || !guest.phone)) return guest.email ? 'email' : 'suppressed';
    return channelOverride;
  }
  if (pref === 'email') return guest.email ? 'email' : 'suppressed';
  if (pref === 'sms') {
    if (smsEnabled && guest.phone) return 'sms';
    return guest.email ? 'email' : 'suppressed';
  }
  // pref === 'both'
  const preferred = TYPE_CHANNEL_PREFERENCE_BOTH[type] ?? 'email';
  if (preferred === 'sms' && smsEnabled && guest.phone) return 'sms';
  return guest.email ? 'email' : (smsEnabled && guest.phone ? 'sms' : 'suppressed');
}
```

### `supabase/functions/webhook-sms/index.ts` (new)

```ts
// Telnyx inbound webhook for STOP/HELP/START.
// Verify signature, look up guest by phone, call record_unsubscribe.

import { createClient } from 'jsr:@supabase/supabase-js';

const TELNYX_PUBLIC_KEY = Deno.env.get('TELNYX_PUBLIC_KEY')!;

Deno.serve(async (req) => {
  const body = await req.text();
  const signature = req.headers.get('telnyx-signature-ed25519');
  const timestamp = req.headers.get('telnyx-timestamp');

  // TODO: ed25519 verification using TELNYX_PUBLIC_KEY, timestamp, body.
  // Reject if signature missing, malformed, or older than 5 minutes.

  const payload = JSON.parse(body);
  const text = (payload.data?.payload?.text ?? '').toLowerCase().trim();
  const fromPhone = payload.data?.payload?.from?.phone_number;

  if (!fromPhone) return new Response('ok', { status: 200 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: guest } = await supabase
    .from('guests')
    .select('id')
    .eq('phone', fromPhone)
    .maybeSingle();

  if (!guest) return new Response('ok', { status: 200 });

  if (['stop', 'unsubscribe', 'cancel', 'end', 'quit'].includes(text)) {
    await supabase.rpc('record_unsubscribe', {
      p_guest_id: guest.id,
      p_channel: 'sms',
      p_source: 'telnyx_stop',
      p_payload: payload,
    });
    // Telnyx auto-replies with the standard STOP confirmation; nothing to send back.
  } else if (text === 'help') {
    // Reply with help text; this counts as a system message and is exempt from STOP.
    // (Implement send via existing Telnyx client.)
  } else if (['start', 'unstop', 'subscribe'].includes(text)) {
    // Re-enable: set notification_preference back to its inferred default
    await supabase.from('guests')
      .update({ notification_preference: 'sms' })
      .eq('id', guest.id);
  }

  return new Response('ok', { status: 200 });
});
```

### `supabase/functions/webhook-email/index.ts` (new)

```ts
// Resend webhook for unsubscribe events.
// Doc: https://resend.com/docs/webhooks
// Verify signature (svix), look up guest by email, call record_unsubscribe.

import { createClient } from 'jsr:@supabase/supabase-js';
import { Webhook } from 'jsr:@svix/webhooks'; // or equivalent

const SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  const body = await req.text();
  const svixId = req.headers.get('svix-id');
  const svixTs = req.headers.get('svix-timestamp');
  const svixSig = req.headers.get('svix-signature');

  let payload: any;
  try {
    const wh = new Webhook(SECRET);
    payload = wh.verify(body, {
      'svix-id': svixId!, 'svix-timestamp': svixTs!, 'svix-signature': svixSig!,
    });
  } catch {
    return new Response('invalid signature', { status: 401 });
  }

  if (payload.type !== 'email.unsubscribed') {
    return new Response('ignored', { status: 200 });
  }

  const email = (payload.data?.to ?? []).pop()?.toLowerCase();
  if (!email) return new Response('ok', { status: 200 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: guest } = await supabase
    .from('guests').select('id').eq('email', email).maybeSingle();

  if (!guest) return new Response('ok', { status: 200 });

  await supabase.rpc('record_unsubscribe', {
    p_guest_id: guest.id,
    p_channel: 'email',
    p_source: 'resend_unsubscribe',
    p_payload: payload,
  });

  return new Response('ok', { status: 200 });
});
```

---

## Frontend changes

### `src/lib/notifications/consent.ts` (new)

```ts
// Centralized consent copy. 10DLC compliance — visible at the moment
// of submission, never behind a modal.

export type ConsentVerb = 'rsvp' | 'order' | 'invite' | 'pickup';

const VERB_PHRASE: Record<ConsentVerb, string> = {
  rsvp: 'By RSVPing',
  order: 'By placing your order',
  invite: 'By inviting a friend',
  pickup: 'By placing a pickup order',
};

export function consentNoteText(verb: ConsentVerb): string {
  return `${VERB_PHRASE[verb]}, you agree to receive SMS and/or email from Cafe Kadhem for event invites, reminders, tickets, and order updates. Reply STOP to opt out of SMS at any time.`;
}
```

### `src/components/ui/ConsentNote.tsx` (new)

```tsx
import { consentNoteText, type ConsentVerb } from '../../lib/notifications/consent';

export function ConsentNote({ verb }: { verb: ConsentVerb }) {
  return (
    <p className="text-xs opacity-60 mt-3 leading-snug">
      {consentNoteText(verb)}
    </p>
  );
}
```

Render under each form's submit button: `<ConsentNote verb="rsvp" />` (or `order`, `invite`, `pickup`).

### Dropdown removal

In each of `RSVPForm.tsx`, `Order.tsx`, `Pickup.tsx`, `InviteForm.tsx`:

- Delete the `<select>` for `notification_preference`.
- Delete the corresponding state field, label, and helper text.
- Do not pass `notification_preference` in the `upsert_guest` call (let the function infer it).

The Settings page on `/my-tickets` keeps the dropdown (added in Commit 4 when that page is built).

---

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Webhook signature verification incorrect → attacker can mass-unsubscribe arbitrary guests | **critical** | Use the official Svix lib for Resend; ed25519 lib for Telnyx. Reject any unsigned/expired payload. Reference: 10DLC requires sender to honor STOP — but only when *that user* sent it |
| 2 | `dedup_key` constraint blocks legitimate resends | medium | The `:retry:N` suffix and explicit `send_attempt_n` increment in invite flow handle this. Document the manual-retry path in admin |
| 3 | `'both'` enum addition fails because column is enum-typed and an existing transaction is open | low | The `DO $$` block adds the value if enum exists; `ADD VALUE` is non-blocking |
| 4 | Per-type routing default (when type not in table) sends via wrong channel | low | Default falls through to email; table is exhaustive for known types |
| 5 | sms_enabled flip suddenly sends queued SMS that were waiting | low (no live data) | Clear `notifications_log` rows with `status='queued'` before flipping if any exist |
| 6 | Forms still pass `notification_preference` in payload after dropdown removal | medium | Search for any references to the removed field; eslint should flag unused state |
| 7 | Webhook URLs unreachable until edge functions deployed | low | Configure webhooks AFTER deploy, not before. Document order in user actions |
| 8 | Consent copy not visible on small screens (320px) | low | Test in browser dev tools; copy is short enough to wrap cleanly |
| 9 | `record_unsubscribe` is `SECURITY DEFINER` granted to `service_role` only — webhook fns must use service role | medium | Verified: webhook fns use `SUPABASE_SERVICE_ROLE_KEY` env var |

---

## Testing plan

### SQL tests

```sql
-- TEST 1: 'both' enum value accepted
INSERT INTO guests (first_name, email, phone, notification_preference)
VALUES ('TestBoth', 'both@test.com', '+15550000099', 'both');
-- Expected: row inserted, no constraint error.

-- TEST 2: Inference for new guest with both channels
SELECT upsert_guest(jsonb_build_object(
  'first_name', 'Inferred',
  'email', 'inf@test.com',
  'phone', '+15550000098'
));
SELECT notification_preference FROM guests WHERE email = 'inf@test.com';
-- Expected: 'both'

-- TEST 3: Inference for phone-only
SELECT upsert_guest(jsonb_build_object(
  'first_name', 'Sms',
  'phone', '+15550000097'
));
SELECT notification_preference FROM guests WHERE phone = '+15550000097';
-- Expected: 'sms'

-- TEST 4: Existing pref preserved
INSERT INTO guests (first_name, email, notification_preference)
VALUES ('Existing', 'exist@test.com', 'email');
SELECT upsert_guest(jsonb_build_object(
  'first_name', 'Existing',
  'email', 'exist@test.com',
  'phone', '+15550000096'
));
SELECT notification_preference FROM guests WHERE email = 'exist@test.com';
-- Expected: 'email' (NOT silently changed to 'both')

-- TEST 5: dedup_key conflict skips duplicate send
INSERT INTO notifications_log (guest_id, type, channel, status, dedup_key)
SELECT id, 'rsvp_confirmation', 'email', 'sent',
       'rsvp_confirmation:'||id||':null:bucket1'
  FROM guests LIMIT 1;
-- Repeat the same insert → expect ON CONFLICT DO NOTHING, no second row.
```

### Edge function tests (manual)

1. **send-notification with pref='both', type='rsvp_confirmation':** verify SMS sent (per routing table).
2. **send-notification with pref='both', type='order_confirmation':** verify email sent.
3. **send-notification with pref='none':** verify no send, log row has status='suppressed'.
4. **send-notification called twice with same dedup_key:** verify only one send occurs.

### Webhook tests

1. **Telnyx STOP:** reply STOP to a test SMS. Verify in `unsubscribe_log` and that `guests.notification_preference = 'none'`.
2. **Telnyx HELP:** reply HELP. Verify reply received, no preference change.
3. **Telnyx START (re-subscribe):** reply START after a STOP. Verify pref returns to `'sms'`.
4. **Resend unsubscribe:** click unsubscribe link in a test email. Verify same audit + pref change.
5. **Webhook with invalid signature:** post a hand-crafted payload with bad signature. Expect 401, no DB write.

### UI tests

1. **Each form (RSVP, Order, Pickup, Invite):** verify the channel-preference dropdown is gone.
2. **Each form:** verify the consent note appears under the submit button, with the correct verb.
3. **Submitting:** verify the submitted form does not include `notification_preference` in payload (check network tab).
4. **`'both'` user:** create a guest with `'both'`, RSVP, verify confirmation arrives via SMS (per routing table).

---

## User actions required

1. **Run migrations 038, 039, 040, 041** in order.

2. **Set environment variables** in Supabase project settings (or `supabase secrets set`):
   - `TELNYX_PUBLIC_KEY=<your-key>` (from Telnyx dashboard → API Keys → Webhook signing key)
   - `RESEND_WEBHOOK_SECRET=<your-secret>` (from Resend dashboard → Webhooks → endpoint)
   - `SITE_URL=https://cafekadhem.com` (or your prod domain)

3. **Deploy edge functions:**
   ```bash
   supabase functions deploy send-notification --project-ref <ref>
   supabase functions deploy webhook-sms --project-ref <ref>
   supabase functions deploy webhook-email --project-ref <ref>
   ```

4. **Configure Telnyx webhook:**
   - Telnyx dashboard → Messaging → Profiles → your profile → Inbound webhook URL
   - Set to: `https://<project>.supabase.co/functions/v1/webhook-sms`
   - Enable: ed25519 signing
   - Save

5. **Configure Resend webhook:**
   - Resend dashboard → Webhooks → Add Endpoint
   - URL: `https://<project>.supabase.co/functions/v1/webhook-email`
   - Events: `email.unsubscribed` (and any others you want to log)
   - Copy the signing secret → set as `RESEND_WEBHOOK_SECRET`

6. **Run all tests above.**

7. **Mark commit verified.**

---

## Rollback plan

```sql
-- Revert sms_enabled
UPDATE admin_settings SET sms_enabled = false;

-- Drop unsubscribe infrastructure
DROP FUNCTION IF EXISTS record_unsubscribe(uuid, text, text, jsonb);
DROP TABLE IF EXISTS unsubscribe_log;

-- Revert upsert_guest to migration 037 version (paste body from
-- supabase/migrations/037_upsert_guest_collision.sql)

-- Note: the 'both' enum value cannot be removed from a Postgres enum
-- without recreating the type. If you must roll back the enum:
--   1. Update all guests with notification_preference='both' to 'email' or 'sms'
--   2. Recreate the type without 'both'
-- Easier: leave 'both' in the enum; nothing references it after rollback.
```

Frontend: `git revert <sha>`.

External: revert webhook URLs in Telnyx + Resend dashboards (or leave them — failed posts will 404 harmlessly until next deploy).

---

## Definition of done

- [ ] Migrations 038, 039, 040, 041 applied
- [ ] Edge functions deployed (3 of them)
- [ ] Webhooks configured in Telnyx + Resend
- [ ] Env vars set
- [ ] All SQL tests pass (5)
- [ ] All edge function tests pass (4)
- [ ] All webhook tests pass (5)
- [ ] All UI tests pass (4)
- [ ] `npm run build` passes

---

## Status section

**Last updated:** 2026-05-06, end of Commit 3

| Sub-item | Status | Notes |
|---|---|---|
| 039 — preference enum 'both' | 🟢 | CHECK constraint extended |
| 040 — unsubscribe_log + record_unsubscribe + merge_guests re-issued | 🟢 | merge_guests now reassigns unsubscribe_log rows |
| 041 — sms_enabled flip | 🟢 | UPDATE admin_settings SET sms_enabled=true |
| 042 — upsert_guest preference inference | 🟢 | infers 'both'/'sms'/'email' from filled fields |
| send-notification updates | 🟢 | dedup_key (pre-send check + ON CONFLICT log), 'both' per-type routing, channel override, 'none' suppression-log |
| webhook-sms function | 🟢 | Telnyx ed25519 verification, STOP/HELP/START handling |
| webhook-email function | 🟢 | Resend Svix HMAC verification, email.unsubscribed handling |
| ConsentNote component + copy | 🟢 | `src/lib/notifications/consent.ts` + `src/components/ui/ConsentNote.tsx` |
| Dropdown removal (RSVPForm) | 🟢 | Order/Pickup/Invite never had one |
| ConsentNote on all 4 forms | 🟢 | RSVPForm, Order, Pickup, InviteForm |
| Types updated for 'both' | 🟢 | `src/lib/types.ts` Guest interface |
| Telnyx webhook configured | ⬜ | User action — see "User actions required" in plan |
| Resend webhook configured | ⬜ | Same |
| Migrations applied | ⬜ | User action |
| Edge functions deployed | ⬜ | User action |
| All tests | ⬜ | User action |

### Result notes (post-commit)

- **Files changed:**
  - `supabase/migrations/039_notification_preference_both.sql` (new)
  - `supabase/migrations/040_unsubscribe_log.sql` (new — also re-issues merge_guests to include unsubscribe_log)
  - `supabase/migrations/041_sms_enabled_flip.sql` (new)
  - `supabase/migrations/042_upsert_guest_infer_preference.sql` (new)
  - `supabase/functions/send-notification/index.ts` (surgical edits)
  - `supabase/functions/webhook-sms/index.ts` (new)
  - `supabase/functions/webhook-email/index.ts` (new)
  - `src/lib/notifications/consent.ts` (new)
  - `src/components/ui/ConsentNote.tsx` (new)
  - `src/components/events/RSVPForm.tsx` (dropdown removed, validation simplified, ConsentNote added)
  - `src/pages/Order.tsx` (ConsentNote added)
  - `src/pages/Pickup.tsx` (ConsentNote added)
  - `src/components/guests/InviteForm.tsx` (ConsentNote added)
  - `src/lib/types.ts` (Guest.notification_preference includes 'both')
- **Deviations** (12 items, see plan Open Questions §"Commit 3 deviations from plan").
- **Build:** `npm run build` passes.
