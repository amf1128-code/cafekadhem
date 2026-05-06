# Implementation Plan — User Flows Consistency

> Living document. **Update the status table and the relevant per-commit doc with every commit.** Designed so a fresh Claude Code session can pick this up cold by reading only this file plus `USER_FLOWS_SPEC.md`.

**Branch:** `claude/user-flow-consistency-ipcaU`
**Spec:** [`USER_FLOWS_SPEC.md`](../USER_FLOWS_SPEC.md) (root of repo)
**Operating assumption:** no live guests/RSVPs yet. Data-destruction risks treated as low. Code-correctness risks remain.

---

## Status Dashboard

| # | Commit | Status | SHA | User-verified | Doc |
|---|---|---|---|---|---|
| 1 | Foundations (additive schema, no behavior change) | 🟢 committed | *(see git log)* | ⬜ pending user verification | [01-foundations.md](commits/01-foundations.md) |
| 2 | Identity merge & reconciliation | ⬜ not started | — | — | [02-identity-merge.md](commits/02-identity-merge.md) |
| 3 | Notifications hardening (channel routing, dedup, consent, suppression) | ⬜ not started | — | — | [03-notifications.md](commits/03-notifications.md) |
| 4 | Recognition & sharing (ambient `?as=`, header, ShareButton, `?ref=`) | ⬜ not started | — | — | [04-recognition-sharing.md](commits/04-recognition-sharing.md) |
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
