# Commit 6 — Bulk operations (mass invites, mass notifications)

> **Goal:** admin can send invites to many recipients at once with a preview/confirm UX, resumable jobs, and per-row dedup. Same primitives serve mass notifications (event updates, reminders, broadcasts) with audience selectors evaluated server-side. Quiet hours and per-day caps protect against runaway spend and STOP-rate damage.

**Status:** ⬜ not started
**Prerequisites:** Commits 1, 2, 3, 4, 5 ✅ user-verified
**Estimated migration files:** 2 (`046`, `047`)
**SHA on commit:** —
**User-verified:** —

---

## Scope summary

- Migration: `bulk_invite_jobs` + `bulk_invite_job_recipients` tables for resumable bulk-invite work.
- Migration: `bulk_notification_jobs` + `bulk_notification_job_recipients` tables for mass notifications.
- Migration: `bulk_invite_max` and `bulk_invite_per_day_max` columns on `admin_settings`.
- New edge function: `bulk-invite/index.ts` — validates recipients, runs in bounded concurrency, writes per-row results.
- New edge function: `bulk-notify/index.ts` — evaluates audience selector server-side, fans out per recipient.
- Update `send-notification` to honor quiet hours for SMS (queue + `send_after`).
- New admin UI: rewrite `EventBulkInvite.tsx` with preview/confirm/resume.
- New admin UI: `MassNotify.tsx` with audience selectors.
- New admin UI: shared `BulkJobProgress.tsx` component.

---

## Files added / modified / deleted

### New

- `supabase/migrations/046_bulk_invite_jobs.sql`
- `supabase/migrations/047_bulk_notification_jobs.sql`
- `supabase/functions/bulk-invite/index.ts`
- `supabase/functions/bulk-notify/index.ts`
- `src/pages/admin/MassNotify.tsx`
- `src/components/admin/BulkJobProgress.tsx`
- `src/components/admin/AudienceSelector.tsx`
- `src/components/admin/RecipientPreviewTable.tsx`

### Modified

- `src/pages/admin/EventBulkInvite.tsx` — full rewrite
- `src/routes.tsx` — add `/admin/notify` route
- `supabase/functions/send-notification/index.ts` — add quiet-hours queueing

---

## Inline migrations

### `046_bulk_invite_jobs.sql`

```sql
-- 046: Resumable bulk invite jobs.
-- One job row per "Send" click. Recipients table tracks per-row status
-- so the admin page can show progress and the job survives a tab close.

CREATE TABLE bulk_invite_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,  -- admin user_id (auth.uid())
  total_recipients int NOT NULL,
  status text NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview', 'sending', 'completed', 'failed')),
  cap text NOT NULL DEFAULT 'all'
    CHECK (cap IN ('all', 'rsvp')),
  custom_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE bulk_invite_job_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES bulk_invite_jobs(id) ON DELETE CASCADE,
  -- Resolved guest (created via upsert_guest during preview)
  guest_id uuid REFERENCES guests(id) ON DELETE SET NULL,
  -- Original input
  input_email text,
  input_phone text,
  -- Resolved invite + send results
  invite_id uuid REFERENCES invites(id) ON DELETE SET NULL,
  notification_id uuid REFERENCES notifications_log(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'will_send', 'sent', 'failed', 'skipped')),
  skip_reason text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX bulk_invite_job_recipients_job_status_idx
  ON bulk_invite_job_recipients (job_id, status);

ALTER TABLE bulk_invite_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_invite_job_recipients ENABLE ROW LEVEL SECURITY;

-- Admin-only access; verify via auth.uid() in policy or just service role
CREATE POLICY "admin reads jobs" ON bulk_invite_jobs
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin writes jobs" ON bulk_invite_jobs
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin reads recipients" ON bulk_invite_job_recipients
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin writes recipients" ON bulk_invite_job_recipients
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Caps in admin_settings
ALTER TABLE admin_settings
  ADD COLUMN IF NOT EXISTS bulk_invite_max int NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS bulk_invite_per_day_max int NOT NULL DEFAULT 1500;
```

### `047_bulk_notification_jobs.sql`

```sql
-- 047: Resumable mass-notification jobs (event updates, broadcasts, etc.)
-- Audience selectors evaluated server-side at send time.

CREATE TABLE bulk_notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,  -- nullable for all_guests selector
  created_by uuid NOT NULL,
  audience text NOT NULL,  -- e.g. 'event:rsvp_yes', 'event:waitlist', 'all_guests'
  type text NOT NULL,  -- notification type for templating
  subject text,        -- email subject; required for type='event_update'
  body text NOT NULL,  -- admin-supplied body (escaped at render)
  total_recipients int,
  status text NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview', 'sending', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE bulk_notification_job_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES bulk_notification_jobs(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES notifications_log(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'queued_quiet_hours')),
  skip_reason text,
  error text,
  send_after timestamptz,  -- for quiet-hours queueing
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX bulk_notification_recipients_job_status_idx
  ON bulk_notification_job_recipients (job_id, status);

ALTER TABLE bulk_notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_notification_job_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads notify jobs" ON bulk_notification_jobs
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin writes notify jobs" ON bulk_notification_jobs
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin reads notify recipients" ON bulk_notification_job_recipients
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin writes notify recipients" ON bulk_notification_job_recipients
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Audience resolution helper. Returns guest_ids matching the selector.
CREATE OR REPLACE FUNCTION resolve_audience(
  p_audience text,
  p_event_id uuid
)
RETURNS TABLE (guest_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  CASE p_audience
    WHEN 'event:rsvp_yes' THEN (
      SELECT r.guest_id FROM rsvps r
       WHERE r.event_id = p_event_id
         AND (r.status = 'yes'
              OR (r.status = 'waitlisted' AND r.payment_status = 'paid'))
    )
    WHEN 'event:rsvp_any' THEN (
      SELECT r.guest_id FROM rsvps r
       WHERE r.event_id = p_event_id AND r.status <> 'no'
    )
    WHEN 'event:waitlist' THEN (
      SELECT r.guest_id FROM rsvps r
       WHERE r.event_id = p_event_id AND r.status = 'waitlisted'
    )
    WHEN 'event:paid' THEN (
      SELECT r.guest_id FROM rsvps r
       WHERE r.event_id = p_event_id
         AND r.status = 'yes' AND r.payment_status = 'paid'
    )
    WHEN 'event:unpaid' THEN (
      SELECT r.guest_id FROM rsvps r
       JOIN events e ON e.id = r.event_id
       WHERE r.event_id = p_event_id
         AND e.ticketing_enabled
         AND r.status = 'yes'
         AND r.payment_status IN ('unpaid', 'pending')
    )
    WHEN 'event:checked_in' THEN (
      SELECT r.guest_id FROM rsvps r
       WHERE r.event_id = p_event_id AND r.checked_in_at IS NOT NULL
    )
    WHEN 'event:no_show' THEN (
      SELECT r.guest_id FROM rsvps r
       WHERE r.event_id = p_event_id
         AND r.status = 'yes'
         AND r.payment_status = 'paid'
         AND r.checked_in_at IS NULL
    )
    WHEN 'all_guests' THEN (
      SELECT id FROM guests WHERE notification_preference <> 'none'
    )
    ELSE
      RAISE EXCEPTION 'unknown_audience: %', p_audience
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_audience(text, uuid) TO authenticated;
```

---

## Edge function sketches

### `supabase/functions/bulk-invite/index.ts`

Two endpoints (POST):

- `POST { action: 'preview', event_id, recipients, cap, custom_message }`
  → creates `bulk_invite_jobs` row with `status='preview'`, populates `bulk_invite_job_recipients` with `status='will_send'` or `status='skipped'` (with reason).
  Returns the job_id and the categorized list.

- `POST { action: 'confirm', job_id }`
  → flips status to `sending`, processes recipients in concurrency=10 batches, updates per-row status, marks job `completed` at end.

Skip reasons (per spec §8.2):
- `notification_preference = 'none'`
- recipient is the cafe owner
- `cap = 'rsvp'` and guest already has an RSVP for this event
- recently invited (`invites.last_sent_at > now() - 24h` for same `(event, inviter, target)`)

Per-row send: `INSERT INTO invites ON CONFLICT DO NOTHING` (uses partial unique index from Commit 1). Then call `send-notification` with `type='invite'` and the new dedup_key bucket.

### `supabase/functions/bulk-notify/index.ts`

Same shape as bulk-invite, but the audience is computed via `resolve_audience(p_audience, p_event_id)` rather than from a recipient list. The admin only chooses the selector + body.

### `send-notification` quiet hours

```ts
function isQuietHours(now: Date, channel: 'sms' | 'email', type: string): boolean {
  if (channel !== 'sms') return false;
  // 21:00 to 09:00 in cafe timezone (America/Los_Angeles or per admin_settings)
  const hour = parseInt(now.toLocaleString('en-US', {
    hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles',
  }), 10);
  const isQuiet = hour >= 21 || hour < 9;
  if (!isQuiet) return false;
  // Exception: event_reminder within 4 hours of doors
  // (caller passes event_starts_at; if within 4h, allow)
  return true;  // simplified; expand per spec §9.3
}

// In the send path: if isQuietHours(now, channel, type) → set
// notifications_log.status = 'queued', send_after = nextAllowedTime,
// and skip the actual provider call. A separate cron/scheduled function
// drains queued rows when their send_after passes.
```

---

## Frontend sketches

### `EventBulkInvite.tsx` rewrite (admin)

Three states: input → preview → executing → done.

```tsx
// 1) Input: textarea or CSV upload with one recipient per line.
//    Each line: "name <email>" or "name +1...".
//    Or paste a CSV.

// 2) Preview: call bulk-invite preview endpoint, show table:
//    | Recipient | Channel | Status |
//    Skipped reasons surfaced. "Send N invites" button.

// 3) Executing: BulkJobProgress polls bulk_invite_jobs row + recipients.

// 4) Done: summary, "Retry failed only" button (creates new job with
//    just the failed rows from the previous job).
```

### `MassNotify.tsx` (new)

```tsx
// Form with:
// - Audience selector (radio or dropdown of options from spec §9.1)
// - Event selector (required for 'event:*' audiences)
// - Type selector (notification type from a small list)
// - Subject (email subject if email is involved)
// - Body (textarea with a {{first_name}} placeholder hint)
// - Preview audience size button → calls resolve_audience, shows count
// - Send button (with confirmation modal: "Send to N people?")
//   For all_guests: requires typing the audience name to confirm.
```

### `BulkJobProgress.tsx`

```tsx
// Polls the job's recipients every 2s until status='completed'.
// Shows progress bar + counts: sent / failed / skipped / pending.
// Live updates the table.
```

---

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Audience selector evaluated at preview time, then stale by send time | medium | Re-evaluate at send; the resolve_audience helper is fast. Document that admin sees a "size as of preview" estimate |
| 2 | Bulk job sends duplicate notifications if dedup_key not threaded correctly | medium | Each recipient row has its own dedup_key bucket; verify in tests |
| 3 | Concurrency causes Telnyx/Resend rate-limit errors | medium | Bound to 10 in flight; back off on 429 with exponential delay |
| 4 | Quiet hours timezone bug → SMS sent at 3am | medium | Hardcode timezone in admin_settings; test with system clock manipulated |
| 5 | `all_guests` audience accidentally selected → sends to everyone | high | Require typed confirmation ("type ALL_GUESTS to confirm") |
| 6 | Per-day cap not enforced atomically — two jobs could both pass the check then both run | low | Use `pg_advisory_lock` keyed on `(event_id, current_date)` for the count check |
| 7 | A bulk job created in `preview` status is abandoned (admin closes tab without confirming) | low | Cleanup: mark `preview` jobs older than 24h as `failed`. Optional pg_cron |
| 8 | "Retry failed only" creates a new job — could double-send if user is confused | low | Show clear warning: "Will resend to N recipients who failed. Continue?" |
| 9 | Bulk invite recipient list contains malformed inputs (typos, weird formatting) | low | Validation pass during preview; bad rows show `status='skipped'` with `skip_reason='invalid_input'` |
| 10 | bulk-invite/notify edge functions need long execution time (sending 500 SMS takes minutes) | medium | Use Supabase background tasks if available; else process recipients in chunks of 50, return after each chunk, frontend re-invokes |

---

## Testing plan

### Bulk invite

1. **Preview empty list:** submit with no recipients → expect error.
2. **Preview valid mix:** 3 new emails, 2 new phones, 1 already-RSVP'd → preview shows 5 will_send, 1 skipped (reason: already_rsvpd) under `cap='rsvp'`.
3. **Confirm and execute:** click Send. Watch BulkJobProgress fill in. After completion, all 5 recipients have `status='sent'` and corresponding `invites` rows exist.
4. **Resume after close:** start a 50-recipient job, close the tab when 10 are done. Reopen the page. Verify progress continues correctly.
5. **Retry failed:** simulate a failure (point Telnyx to a bad endpoint temporarily). Some recipients fail. Click Retry Failed. Verify a new job sends only to the failed set.
6. **Cap exceeded:** attempt to send 600 recipients with `bulk_invite_max=500`. Expect rejection.
7. **Per-day cap:** send 1500 across multiple jobs. Next job rejected with "daily cap reached".

### Mass notify

8. **Preview audience size:** select `event:rsvp_yes` for an event with 12 yes-RSVPs → preview shows "12 recipients".
9. **Send notification:** confirm send. Verify each recipient gets one notification, dedup_key bucket = `event_update:<guest_id>:<event_id>:<event.updated_at>`.
10. **Re-send same selector with same body:** verify dedup_key collision causes ON CONFLICT DO NOTHING; nobody re-receives.
11. **All guests confirmation:** select `all_guests`, attempt send. Expect typed confirmation prompt.
12. **Quiet hours:** with clock at 22:00 (or override), send SMS notification → row should be `status='queued_quiet_hours'` with `send_after = next 09:00`.
13. **Audience evaluation server-side:** verify the recipient list in `bulk_notification_job_recipients` matches `SELECT resolve_audience(...)` exactly.

---

## User actions required

1. **Run migrations 046, 047** in order.
2. **Deploy edge functions:**
   ```bash
   supabase functions deploy bulk-invite --project-ref <ref>
   supabase functions deploy bulk-notify --project-ref <ref>
   supabase functions deploy send-notification --project-ref <ref>
   ```
3. **Optionally configure pg_cron** (in Supabase SQL editor) for queued-message draining and stale-preview-job cleanup:
   ```sql
   -- (pseudo) CREATE EXTENSION pg_cron;
   -- SELECT cron.schedule('drain-queued-sms', '*/5 * * * *',
   --   $$ /* select notifications_log where status='queued' and send_after <= now() … */ $$);
   ```
4. **Run all tests above.**
5. **Mark commit verified.**

---

## Rollback plan

```sql
DROP FUNCTION IF EXISTS resolve_audience(text, uuid);
DROP TABLE IF EXISTS bulk_notification_job_recipients;
DROP TABLE IF EXISTS bulk_notification_jobs;
DROP TABLE IF EXISTS bulk_invite_job_recipients;
DROP TABLE IF EXISTS bulk_invite_jobs;
ALTER TABLE admin_settings
  DROP COLUMN IF EXISTS bulk_invite_per_day_max,
  DROP COLUMN IF EXISTS bulk_invite_max;
```

Frontend: `git revert <sha>`. Edge functions: redeploy without bulk-invite/bulk-notify or just delete from Supabase dashboard.

---

## Definition of done

- [ ] Migrations 046, 047 applied
- [ ] 3 edge functions deployed (or redeployed)
- [ ] All 13 tests pass
- [ ] `npm run build` passes
- [ ] No regressions in single-invite flow (Commit 2 still works)
- [ ] No regressions in single-notification sends (Commit 3 still works)

---

## Status section

**Last updated:** *(when implementation starts)*

| Sub-item | Status | Notes |
|---|---|---|
| 046 — bulk_invite_jobs | ⬜ | |
| 047 — bulk_notification_jobs | ⬜ | |
| bulk-invite edge fn | ⬜ | |
| bulk-notify edge fn | ⬜ | |
| send-notification quiet hours | ⬜ | |
| EventBulkInvite rewrite | ⬜ | |
| MassNotify page | ⬜ | |
| BulkJobProgress component | ⬜ | |
| AudienceSelector component | ⬜ | |
| RecipientPreviewTable component | ⬜ | |
| All tests | ⬜ | |

### Result notes (post-commit)

*(To be filled in.)*
