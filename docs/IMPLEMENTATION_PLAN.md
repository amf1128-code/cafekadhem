# Implementation Plan — User Flows Consistency

> Living document. **Update the status table and the relevant per-commit doc with every commit.** Designed so a fresh Claude Code session can pick this up cold by reading only this file plus `USER_FLOWS_SPEC.md`.

**Branch:** `claude/user-flow-consistency-ipcaU`
**Spec:** [`USER_FLOWS_SPEC.md`](../USER_FLOWS_SPEC.md) (root of repo)
**Operating assumption:** no live guests/RSVPs yet. Data-destruction risks treated as low. Code-correctness risks remain.

---

## Status Dashboard

| # | Commit | Status | SHA | User-verified | Doc |
|---|---|---|---|---|---|
| 1 | Foundations (additive schema, no behavior change) | ✅ verified | `4af91ba` + hot-fix `91181e7` | ✅ 2026-05-06 | [01-foundations.md](commits/01-foundations.md) |
| 2 | Identity merge & reconciliation | ✅ verified | `ae873e0` | ✅ 2026-05-06 | [02-identity-merge.md](commits/02-identity-merge.md) |
| 3 | Notifications hardening (channel routing, dedup, consent, suppression) | ✅ verified | `71aa05f` | ✅ 2026-05-06 | [03-notifications.md](commits/03-notifications.md) |
| 4 | Recognition & sharing (ambient `?as=`, header, ShareButton, `?ref=`) | 🟢 committed | *(see git log)* | ⬜ pending user verification | [04-recognition-sharing.md](commits/04-recognition-sharing.md) |
| 5 | State unification (`get_guest_event_state` consumed by all pages) | ⬜ not started | — | — | [05-state-unification.md](commits/05-state-unification.md) |
| 6 | Bulk operations (mass invites, mass notifications, audience selectors) | ⬜ not started | — | — | [06-bulk-operations.md](commits/06-bulk-operations.md) |

**Status legend:** ⬜ not started · 🟡 in progress · 🟢 committed · ✅ user-verified · 🔴 blocked

---

## How to use this document

### For Claude (resuming a session)

1. Read this file top-to-bottom. The status table is your starting point.
2. Read `USER_FLOWS_SPEC.md`. That's the canonical "what we're building."
3. Open the per-commit doc for the next ⬜ or 🟡 entry. Each per-commit doc is self-contained: scope, files, full migration SQL, key signatures, risks, test plan, user actions, rollback, definition of done.
4. **Before starting work**, restate to the user which commit you're picking up and confirm the operating assumption (no live guests) still holds.
5. **After committing**, update the row in the status table above AND the "Result" / "Status" sections at the bottom of the per-commit doc.
6. Do not change spec without explicit user approval. If you discover a spec gap, append it to the "Open Questions" section below and surface it.

### For the human

- Each per-commit doc has a **"User actions required"** section. That's the manual stuff (running migrations, configuring webhooks, deploying edge functions, flipping admin settings). Migrations are committed to `supabase/migrations/` AND included inline in the per-commit doc so you can paste them into the Supabase SQL editor without context-switching.
- Each per-commit doc has a **"Testing plan"** section with concrete manual steps. Run them after deploying that commit's changes.
- The status table above is the single source of truth for what's done. If a commit is `🟢 committed` but not `✅ user-verified`, do not move on — verification gates the next commit.

---

## Pre-flight checklist (before Commit 1)

- [ ] Supabase project access (CLI or dashboard) confirmed
- [ ] Branch `claude/user-flow-consistency-ipcaU` checked out
- [ ] `supabase/migrations/` directory next migration number = `029` (current latest is `028`)
- [ ] Confirmed: no live guests/RSVPs/orders in production data (this assumption gates the merge_guests work; if it changes, re-read the risks section in `02-identity-merge.md`)
- [ ] Telnyx 10DLC: confirmed approved (per user, 2026-05)
- [ ] Resend: account active for transactional sends
- [ ] Local dev env runs (`npm run dev`) without errors

---

## Cross-cutting concerns

### Environment variables

To be added incrementally per commit; cumulative list lives here.

| Var | Where set | Purpose | Added in |
|---|---|---|---|
| `SUPABASE_URL` | already set | — | — |
| `SUPABASE_ANON_KEY` | already set | — | — |
| `TELNYX_API_KEY` | already set | — | — |
| `RESEND_API_KEY` | already set | — | — |
| `TELNYX_WEBHOOK_SECRET` | edge fn env | verify STOP/HELP webhook signatures | Commit 3 |
| `RESEND_WEBHOOK_SECRET` | edge fn env | verify unsubscribe webhook signatures | Commit 3 |
| `AMBIENT_TOKEN_TTL_DAYS` | edge fn env | how long ambient `?as=` tokens are valid (default 90) | Commit 4 |

### External service configuration

| Service | Setting | Value | Configured in |
|---|---|---|---|
| Telnyx | Webhook URL for inbound SMS (STOP/HELP) | `https://<project>.supabase.co/functions/v1/webhook-sms` | Commit 3 |
| Telnyx | Webhook signature verification | enabled (HMAC) | Commit 3 |
| Resend | Webhook URL for unsubscribe events | `https://<project>.supabase.co/functions/v1/webhook-email` | Commit 3 |
| Resend | Webhook signature verification | enabled | Commit 3 |
| Supabase | Edge function deploys | `send-notification`, `webhook-sms`, `webhook-email`, others per commit | per commit |
| `admin_settings.sms_enabled` | DB row | `true` (10DLC approved) | Commit 3 |

### Edge function deploys

After each commit that touches `supabase/functions/`, run:

```bash
supabase functions deploy <fn_name> --project-ref <your-project-ref>
```

The list of functions modified is in each per-commit doc under **"User actions required"**.

### Rollback strategy (overall)

- **Schema rollbacks:** every migration in this plan ships with a paired rollback block at the bottom of its per-commit doc. Run rollback blocks in **reverse order** if a commit needs to be undone.
- **Code rollbacks:** `git revert <sha>` of the commit. Per-commit docs note any side-effects that revert won't undo (e.g., admin settings flips).
- **Operating assumption again:** because there are no live guests yet, "rollback" is mostly precautionary. Worst case: `TRUNCATE TABLE guests, rsvps, orders, pickup_orders CASCADE` and re-test from scratch. This is documented as the "nuclear option" in each commit's rollback section.

---

## Decision log (running, supplements `USER_FLOWS_SPEC.md` §12)

| # | Date | Decision | Rationale |
|---|---|---|---|
| 1 | 2026-05-06 | Implement spec in 6 commits on a single branch, all in one Claude session. | User confirmed no live data; data-destruction risks → low. Phasing across deploys is unnecessary overhead. |
| 2 | 2026-05-06 | Per-commit docs split into `docs/commits/0N-*.md` with top-level index here. | User preference. Improves handoff readability. |
| 3 | 2026-05-06 | Each migration is committed to `supabase/migrations/` AND copied inline into the per-commit doc. | User asked for inline code; duplication is acceptable for handoff completeness. |

---

## Open questions (carry across sessions)

> Anything Claude discovers during implementation that deviates from spec or needs user input. Append here; do not silently resolve.

### Commit 1 deviations from plan

1. **`normalizePhone` was already centralized** at `src/lib/utils/phone.ts` (with `formatPhone` and `isValidPhone`). The plan said to "hoist" it; the actual move was to add `src/lib/utils/contact.ts` that re-exports `normalizePhone` from `phone.ts` and adds `normalizeEmail` + `normalizeInstagram`. RSVPForm/Order/Pickup imports were not changed (they already use the centralized `phone.ts`).
2. **Plus-one column is `plus_one_of` (RSVP id)**, not `plus_one_of_guest_id`. The plan's trigger sketch and `get_guest_event_state` shape both used the wrong name. Migrations 029 and 034 use the actual column, joining through `rsvps.plus_one_of → rsvps.id` to find a parent's plus-ones, then to `guests` for the name.
3. **`safe_create_rsvp` returns `rsvps` (the row), not jsonb.** The plan's sketch returned jsonb, which would have broken every existing caller. Migration 033 preserves the original signature; the body adds the advisory lock and the paid→non-yes block, plus keeps the contact-dedup logic from migration 025.
4. **`get_guest_event_state.invited_by` is currently `NULL`**. Wiring it up requires the ambient/invite token resolution from Commit 4.
5. **`useGuestEventState` hook** (planned in Commit 5) will type the response. The shape returned by 029 matches the plan's spec §5 shape exactly except for `invited_by` (see #4).
6. **Hot-fix migration 035** added after user testing: `events.is_published BOOLEAN`, not `events.status TEXT` as the plan and 029 assumed. Migration 035 replaces `get_guest_event_state` body with the corrected SELECT and `IF NOT v_event.is_published` check.
7. **Migration numbering for Commit 2 shifts by 1.** What the plan calls `035`/`036`/`037` (`merge_guests`, `merge_verifications`, `upsert_guest_collision`) becomes `036`/`037`/`038`. Subsequent commits' migration numbers also shift accordingly.

### Commit 4 deviations from plan

1. **Migration numbering shifted by 1 again**: 043/044/045 instead of plan's 042/043/044.
2. **`merge_guests` re-issued in migration 045** to add `referred_by_guest_id` and `ambient_tokens` to FK reassignment list. This is the third re-issue (036, 040, 045) — each new commit that adds a guest-FK target must re-issue. Future commits should follow the same pattern.
3. **Ambient token minted per-send, not per-link**: spec said "mint a token for this guest" and inject. Implementation mints exactly one token per `send-notification` call and reuses it across all same-domain URLs in that send. Cleaner than minting per link.
4. **`injectAmbientToken` skips `/verify-merge` URLs explicitly**: those are single-use credentials; recognition is already handled by the verify flow's success redirect.
5. **`mint_ambient_token` failure is non-fatal**: if the mint RPC errors, the notification still goes out (just without `?as=`). Logged to console for admin visibility. Avoids the failure mode where a transient RPC issue blocks confirmations entirely.
6. **`useMyGuest` uses `useSyncExternalStore`** with a custom event channel (`GUEST_TOKEN_EVENT`) so the recognition header updates in real-time when localStorage changes within the same tab. Plain `storage` events only fire across tabs. `setGuestToken` and `clearGuestToken` now dispatch the event.
7. **Ticket page ShareButton omits `?ref=`**: `TicketView` doesn't include `guest_id`, so we can't attribute. Acceptable — the share still works; attribution just isn't captured. A small future migration to extend `get_ticket` could add it.
8. **`AmbientTokenHandler` strips param via `navigate({...}, {replace: true})`**: prevents back-button revealing the token. Tested in build; need real-browser verification.
9. **`RecognitionHeader` confirm dialog**: uses native `confirm()` for "not you?" rather than building a custom modal. Acceptable for v1.
10. **`smsEnabled`-vs-not branching in RSVPForm validation simplified** (carried over from Commit 3): when SMS disabled, email is required; when SMS enabled, either is fine. The forced-fallback effect that flipped 'sms' → 'email' on smsEnabled change was removed because preference is now inferred, not user-set.
11. **`set_rsvp_referrer` is fire-and-forget** in the RSVPForm (no `await`) so a failure doesn't block the RSVP confirmation. Attribution is metadata, not transactional.

### Commit 3 deviations from plan

1. **Migration numbering shifted by 1**: 039/040/041/042 instead of plan's 038/039/040/041 (Commit 1 hot-fix took 035; subsequent commits shifted).
2. **`merge_guests` re-issued in migration 040** to add `unsubscribe_log` to its FK reassignment list (table didn't exist yet when 036 was written). Pure additive change; behavior identical otherwise.
3. **`record_unsubscribe` always sets preference to `'none'`**, not channel-specific suppression. Spec mentions per-channel suppression but the existing schema has a single `notification_preference` column; multi-channel suppression would need a separate columns scheme. Keeping it simple: any STOP or unsubscribe → `'none'`. Admin can re-enable a specific channel via Guest Directory.
4. **`send-notification` extension was surgical, not a rewrite**: kept all existing template / ICS / QR logic; only added channel routing for `'both'`, dedup_key handling, pre-send dedup check, and the `'none'` suppression-log path. The plan called for a rewrite; surgical is lower risk.
5. **Pre-send dedup check** queries `notifications_log` once before the provider call. If a `status='sent'` row already exists with the same `dedup_key`, we return `{ skipped: true, reason: 'dedup' }` without sending. This is in addition to the partial unique index (which is the last-resort guard).
6. **`webhook-sms` and `webhook-email` reject all requests until env vars are set**, by design. `TELNYX_PUBLIC_KEY` and `RESEND_WEBHOOK_SECRET` are required for signature verification; without them, the webhooks return 401. Avoids the security failure mode where unsigned requests could mass-unsubscribe guests.
7. **`'both'` per-type routing table** (BOTH_PREFERS_SMS) lives inline in `send-notification`. Adding new notification types means updating that table; default for unknown types is `email`.
8. **Channel override** (added in Commit 2 for `merge_verification`) is now used by `webhook-sms` indirectly: the override channel takes precedence over the guest's preference (so a STOP-blocked guest doesn't accidentally re-subscribe via a forced send).
9. **`order_confirmation` and `pickup_order_confirmation` magic-link channel selection** in send-notification still uses the *old* `notification_preference === 'sms' && phone` check (not the new routing table) for which channel the magic link goes to. Acceptable: the magic link travels with the confirmation, so it goes to whatever channel the confirmation goes to. No bug, just a thing to know.
10. **The `'none'` log row uses `status='queued'`** because the existing `notifications_log.status` CHECK only allows `(sent|failed|queued)`. The error column carries `'suppressed: notification_preference=none'`. A future migration could extend the CHECK to add `'suppressed'` for cleaner querying.
11. **InviteForm consent note** rendered below the existing form rather than between fields and submit, because the InviteForm uses a horizontal flex layout. Visually consistent with the other forms (note appears immediately below the action area).
12. **Existing RSVPForm validation** referenced `notifPref === 'sms' && !phone` and `notifPref === 'email' && !email`. Both removed since preference is now inferred. Replaced with: at least one of email or phone required when SMS is enabled; email-only required when SMS is disabled.

### Commit 2 deviations from plan

1. **`upsert_guest` return type changed from `guests` (row) to `JSONB`.** Required to carry `pending_merge`. The JSONB shape is `to_jsonb(guest_row) || {pending_merge}`, so callers that read `.id`, `.first_name`, `.email`, etc. continue to work. All three frontend callers (RSVPForm, Order, Pickup) updated to handle the new field.
2. **`verification_token` minted server-side inside `upsert_guest`**, not by the frontend. Avoids an extra RPC round-trip and keeps the token-mint logic SECURITY DEFINER. The frontend just forwards the token to `send-notification`.
3. **`request_merge_verification` granted to `service_role` and `authenticated` only**, not anon. The `upsert_guest` SECURITY DEFINER context invokes it transitively, so anon callers can still trigger Case B without having direct grant.
4. **`merge_guests` notably does NOT touch `rsvps.plus_one_of`** — that column references `rsvps.id`, not `guests.id`. Plus-one rows whose parent gets deleted in conflict resolution are CASCADE-deleted via the existing FK.
5. **Channel override** added to `send-notification`: when `data.channel` is `'sms'` or `'email'`, it overrides `guest.notification_preference`. Used by `merge_verification` to ensure the link goes to the channel that owns the matched row, not the guest's default.
6. **`add_plus_one` not affected by merge.** The plus-one creation function uses parent RSVP id, not guest id, so plus-ones survive a merge of their parent guest.
7. **`'both'` enum value** referenced in the plan's upsert_guest sketch is **not** added in Commit 2 — that's deferred to Commit 3 (migration 040). Migration 038 still validates against `('sms', 'email', 'none')` to match the existing CHECK constraint.

---

## Handoff notes

### If a session ends mid-commit

1. Update the per-commit doc's "Status" section with what's done and what's left (file-level granularity).
2. Update the status table above (e.g., 🟡 in progress).
3. Note any uncommitted local changes — prefer to commit WIP with a clear `wip:` prefix rather than leave the working tree dirty.
4. Surface to the user: which commit was in flight, what's left, any blockers.

### If the spec evolves mid-implementation

1. Update `USER_FLOWS_SPEC.md` first.
2. Update the affected per-commit doc(s).
3. Note in the decision log here.
4. Don't try to retrofit prior commits — if the change affects already-committed work, open a follow-up commit.

### Known traps for future sessions

- **`supabase/functions/send-notification/index.ts` is the highest-touch file.** Commits 3, 4, and 6 all modify it. Don't rebase its changes; merge them.
- **`upsert_guest` is replaced in Commit 2.** Migrations 020/026/028 are the current version. Don't pattern-match on those; read 037 (Commit 2) for the post-refactor shape.
- **`safe_create_rsvp` is replaced in Commit 1.** Same caveat — current is 002; new is 033.
- **The `rsvps` table grows several columns across commits.** By the end: `referred_by_guest_id` (Commit 4), advisory-lock semantics (Commit 1). Trace columns through migrations in order.
