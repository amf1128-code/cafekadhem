# Cafe Kadhem — User Flows & Consistency Spec

> Companion to `BUILD_PLAN.md`. Defines the canonical rules governing how guests, RSVPs, orders, tickets, invites, and notifications interact — within one event and across many. Anchors current behavior in code and resolves the edge cases ahead of mass-invite and mass-notification work.
>
> **Scope:** every public entry point (Home, EventDetail, Order, InviteLanding, Ticket, FindTickets, MyTickets, Pickup) and every admin entry point that mutates a guest-visible state. Pickup is included because it shares the guest entity, but it is event-agnostic and treated separately where noted.

---

## 1. Goals & Non-goals

**Goals**
1. One guest = one row, regardless of which flow they enter through.
2. State for `(guest, event)` is derivable from the database — no client-side guessing.
3. Every mutation has a single canonical RPC. Pages call it; they do not duplicate its logic.
4. Bulk operations (invites, notifications) are **per-recipient transactions** with idempotency and partial-failure semantics; they never leave the system in an "everyone got it except…" mystery state.
5. The user-visible "what happens next?" is a function of `(guest, event)` state, not of which page they came from.

**Non-goals**
- Multi-tenant. There is one cafe.
- Real-time collaboration on a single RSVP/order. Last write wins per row.
- Auth for non-admins. Public flows are token- or contact-gated, not session-gated.

---

## 2. Canonical Entities

| Entity | Identity | Notes |
|---|---|---|
| `guests` | `id` (uuid). Logical identity = (normalized phone) ∪ (lowercased email). | Plus-ones are stub guests with both fields NULL (`023_plus_one.sql`). |
| `events` | `id`. | `capacity` may be NULL (unlimited). `ticketing_enabled`/`ticket_price` toggle paid mode. |
| `rsvps` | `(event_id, guest_id)` unique. | Carries ticket fields when event is ticketed. **A ticket is not a separate entity** — see §6.4. |
| `orders` / `order_items` | `id`. Linked to `(event_id, guest_id)`. | Independent of RSVP existence — a guest can place a food order without RSVPing, and vice versa, but UI funnels them together. |
| `invites` | `token` (32-char hex). | Tied to `(event_id, invited_email|invited_phone)`. Reusable link, single logical send per row. |
| `pickup_orders` | `id`, public lookup by `pickup_token` (uuid). | Event-agnostic. |
| `notifications_log` | `id`. | Append-only audit. See §8. |

---

## 3. Identity & Dedup (foundation)

Every flow that takes contact info from a user resolves to one guest row through `upsert_guest()` (`020`/`028`). The rules below extend that function with normalization invariants the client must uphold.

### 3.1 Normalization rules (client-side, before any RPC)

| Field | Rule |
|---|---|
| `email` | `trim()` then `toLowerCase()`. Empty string → `null`. |
| `phone` | Strip all non-digits. Prepend country code only if the input had one. Store as E.164 (`+1XXXXXXXXXX`). Empty → `null`. The existing `normalizePhone()` in `RSVPForm.tsx:188` and `Order.tsx:150` is the canonical implementation; **it must be hoisted to `src/lib/utils/contact.ts` and reused**. No page may roll its own. |
| `first_name` | `trim()`. Required. |
| `instagram` | Strip leading `@`, trim, lowercase. |

### 3.2 Match precedence in `upsert_guest`

Already implemented in `028_restore_upsert_guest.sql`:

1. If `p_guest_id` provided and row exists → update by id (overrides any contact-based match).
2. Else: case-insensitive **email** match, most recent.
3. Else: exact **phone** match, most recent (phone is already E.164 by §3.1, so exact = correct).
4. Else: insert.

**Edge cases & rules:**

- **Email collision with different phone**: the email match wins; phone field is overwritten with the new value (since `p_fields` includes phone). This is intentional: the latest contact info supersedes.
- **Phone collision with different email**: same logic in reverse.
- **Cross-channel merge**: A guest who first RSVPs with email-only, then later submits with email + phone, gets the phone added to their existing row. ✅ already works.
- **Cross-channel split** (rare): A guest first uses phone-only, then later uses email-only with no phone. The email lookup fails (no row has that email), the phone lookup also fails (no phone in payload to match), so a **new row is created** — identity splits. **This is accepted**; we do not attempt fuzzy/by-name merging. Admin can manually merge via Guest Directory if it matters.
- **Plus-one**: created via `add_plus_one()` only. Plus-one rows are NEVER returned from `upsert_guest` matching, because they have NULL contact (the function requires email or phone, see `020:43-49`).

### 3.3 Guest_id persistence in the browser

- After any successful `upsert_guest`, the page writes `localStorage.guest_id = id`.
- All subsequent RPCs in the session pass `p_guest_id` so step 1 of §3.2 fires — this prevents a guest who edits their email mid-session from being silently merged into a stranger's row.
- `localStorage.guest_id` is cleared by `/find-tickets` magic-link redemption (which sets it to the redeemed guest), and by an explicit "Not me" link on EventDetail (to be added) so a shared device can re-identify.

---

## 4. Per-Flow Specs

Every flow below ends in the same place: a **post-action state** for `(guest, event)`. §5 defines that state machine.

### 4.1 RSVP (EventDetail / RSVPForm)

**Inputs:** `event_id`, contact fields, status ∈ {yes, maybe, no}, optional plus-one name.

**Pipeline:**
1. Normalize per §3.1.
2. `upsert_guest({...})` → `guest_id`.
3. `safe_create_rsvp(event_id, guest_id, status)` → returns `{ status, waitlist_position }` (`002_waitlist.sql`).
4. If `event.rsvp_required` is false (drop-in event, `016`), step 3 is skipped — no RSVP row is created. The form just collects the guest for notifications.
5. If `event.ticketing_enabled` and returned status = `yes` → render payment block.
6. If plus-one provided and parent status ∈ {yes, waitlisted} → `add_plus_one()` (`023`).

**Status outputs from `safe_create_rsvp`:**
- `yes` if `capacity IS NULL` OR existing yes-count < capacity.
- `waitlisted` if `p_status='yes'` and capacity is full. `waitlist_position` assigned.
- `maybe` / `no` always honored verbatim.

**Edge cases:**
- **Re-submitting RSVP** (idempotent UPSERT on `(event_id, guest_id)`): allowed. New status replaces old.
- **yes → no on a full event**: frees a slot but does NOT auto-promote. Promotion is admin-driven (`promote_from_waitlist`, `012`). This is intentional so the host can choose who is invited to fill the seat.
- **yes → maybe**: same — frees the seat, no auto-promote, waitlist positions are not re-ranked. **New rule (§9): waitlist gaps are tolerated**; reranking happens lazily inside `promote_from_waitlist`.
- **waitlisted → no**: clears waitlist fields, no rerank.
- **maybe → yes when full**: `safe_create_rsvp` downgrades to waitlisted with a fresh `waitlist_position` at the tail.
- **Plus-one when parent later changes to no/maybe**: parent's plus-ones are deleted. Implemented in `024_plus_one_edit.sql` via `remove_plus_one`; **must also fire automatically when the parent status leaves {yes, waitlisted}**. (TODO: add trigger or extend `safe_create_rsvp`.)
- **Drop-in event** (`rsvp_required=false`): no RSVP row, no capacity check, no waitlist. Notifications still respect `notification_preference`.

### 4.2 Food Order (Order page)

**Inputs:** `event_id`, contact fields, cart items, payment_method.

**Pipeline:**
1. Normalize → `upsert_guest` → `guest_id`.
2. `safe_create_order(event_id, guest_id, items, total, payment_method)`.
3. Render confirmation card in-page with Venmo deep link, plus an explicit "Back to event" link.

**Rules:**
- An order does **not** create or modify an RSVP. If the guest hasn't RSVP'd, the Order page must show a non-blocking inline notice ("You haven't RSVP'd — order will be held but seat is not reserved") with a one-click "RSVP yes" button that calls `safe_create_rsvp` from the same form values.
- Orders are independent of payment status for tickets. The Venmo note for a food order is `"<name> – <event_title> food"`; for a ticket payment it is `"<name> – <event_title> ticket"`. (Distinct notes prevent admin confusion when verifying receipts.)
- **Editing an order**: not supported in v1. Guest contacts admin. UI must hide any "edit" affordance.
- **Re-submission** of the same cart: produces a second order. **No client-side dedup**; admin must reconcile. (Future: include an idempotency key derived from `hash(guest_id, event_id, cart_signature)` and reject within a 60-second window.)

### 4.3 Ticket (paid RSVP)

A ticket is the same row as the RSVP, gated by `payment_status` and identified externally by `ticket_token` (`010_tickets.sql`).

**State machine on `rsvps`:**

```
unpaid ──[guest clicks "I've Paid"]──▶ pending
pending ──[admin: mark_rsvp_paid]──▶ paid (token issued, paid_at set)
paid ──[admin: mark_rsvp_unpaid]──▶ unpaid (token preserved, see below)
paid ──[admin: refund]──▶ refunded (token revoked at lookup time)
paid ──[scanner: check_in_ticket]──▶ paid + checked_in_at (idempotent)
```

**Rules:**
- `mark_rsvp_paid` is idempotent: re-running on a paid row returns the same `ticket_token`.
- `mark_rsvp_unpaid` does **not** delete `ticket_token`. Reason: if the admin un-marks by mistake, the same QR continues to work after re-marking. Lookup (`get_ticket`) checks `payment_status='paid'` to decide validity — the token alone is not authority.
- **Refund**: `payment_status='refunded'`, `get_ticket` returns `valid: false`. Token row is preserved for audit.
- **Check-in**: `check_in_ticket` is admin-only and idempotent (`already_checked_in` flag). Re-scan never errors.
- **Status change yes → no on a paid RSVP**: blocked. Guest must contact admin for refund first. Add a UI guard in `RSVPForm.tsx` plus a server-side check in `safe_create_rsvp` (currently missing — see §11 follow-ups).
- **Lost ticket**: guest uses Find Tickets (§4.6) with their phone/email; magic link returns the token.

### 4.4 Invite (single)

**Create** (`InviteForm.tsx`):
- Inviter must be a known guest in `localStorage`. If not, force them through an "Identify yourself" mini-form first.
- Insert `invites(event_id, invited_by, invited_email|invited_phone, token)`. Token auto-generated.
- Fire `send-invite` edge function with the new token.
- **Rule:** at most one outstanding invite per `(event_id, invited_email|invited_phone, invited_by)`. If a duplicate is attempted, **reuse the existing token** and re-send the notification (idempotent from the inviter's perspective). Add a partial unique index:
  ```sql
  CREATE UNIQUE INDEX invites_unique_target_idx
    ON invites (event_id, invited_by, COALESCE(lower(invited_email), invited_phone));
  ```

**Consume** (`InviteLanding.tsx` → `/events/:id`):
- Token is **reusable** (no `used_at`): the link can be forwarded, opened on multiple devices, refreshed. This is intentional — invitations are social, not authentication.
- The landing page passes `{ invitedBy, invitedTarget }` in router state. EventDetail shows a banner ("You were invited by Lina") and **prefills** the contact field that matches the invite target (email or phone).
- **Identity mismatch**: if the invitee RSVPs with a contact different from the invite target, we accept it — they may be RSVPing on behalf of a household. The `invites.consumed_by_guest_id` column (NEW, see §11) is set to whichever guest_id ultimately RSVPs from this token's session, for analytics. The invite is not "consumed" in a blocking sense.
- **No invite, direct event link**: always allowed. The invite system is a notification + attribution channel, not a gate.

### 4.5 Pickup (event-agnostic)

Out of scope for cross-event consistency, but inherits the §3 identity rules. Two adjustments:

- Use the same `upsert_guest` path. Currently `Pickup.tsx:170-279` does — keep it that way.
- Pickup notifications must respect `guests.notification_preference` and the global `admin_settings.sms_enabled` toggle (§7).

### 4.6 Find Tickets / My Tickets

- `/find-tickets` takes contact, calls `find_guest_by_contact` edge → emits a magic link.
- `/my-tickets?token=…` redeems via `redeem_magic_link` (`013_magic_links.sql`), then `get_guest_history` returns all RSVPs/tickets/orders/pickups for that guest_id across events.
- Magic links are single-use, 30-minute TTL. After redemption, `localStorage.guest_id` is set so subsequent RSVPs on the device skip identification.

---

## 5. Cross-Flow State: `(guest, event)`

This is the **single source of truth** for "what should the user see / do next?". Implement as a server-side selector — call it `get_guest_event_state(p_event_id, p_guest_id)` — and use its output everywhere a page decides what to render. No page may infer this from a partial subset of fields.

**Returned shape:**
```ts
{
  rsvp: 'yes'|'maybe'|'no'|'waitlisted'|null,
  waitlist_position: number|null,
  plus_one: { name: string }|null,
  is_ticketed_event: boolean,
  payment_status: 'unpaid'|'pending'|'paid'|'refunded'|null,
  ticket_token: string|null,        // null unless caller is the guest (RPC SECURITY DEFINER + guest_id check)
  checked_in_at: timestamp|null,
  has_food_order: boolean,
  food_order_total: number|null,
  capacity_remaining: number|null,  // null = unlimited
  invited_by: string|null,          // first_name of the inviter, if a token was used this session
  next_step: 'rsvp'|'pay'|'view_ticket'|'view_order'|'add_plus_one'|'edit_rsvp'|'closed',
}
```

**`next_step` decision tree (canonical):**

```
event.status != 'published'                      → 'closed'
rsvp is null
  ∧ event.rsvp_required                          → 'rsvp'
  ∧ ¬event.rsvp_required ∧ has_food_order        → 'view_order'
  ∧ ¬event.rsvp_required ∧ ¬has_food_order       → 'rsvp'      (collect contact)
rsvp = 'yes' ∧ is_ticketed_event ∧ payment_status='unpaid'   → 'pay'
rsvp = 'yes' ∧ is_ticketed_event ∧ payment_status='pending'  → 'pay'   (show "awaiting confirmation")
rsvp = 'yes' ∧ is_ticketed_event ∧ payment_status='paid'     → 'view_ticket'
rsvp = 'yes' ∧ ¬is_ticketed_event                            → 'edit_rsvp'
rsvp = 'waitlisted'                              → 'edit_rsvp' (show position)
rsvp ∈ {'maybe','no'}                            → 'edit_rsvp'
```

**Routing convention** (resolves the Order vs Pickup inconsistency flagged by research):

| `next_step` | URL |
|---|---|
| rsvp | `/events/:id` (form expanded) |
| pay | `/events/:id` (payment block expanded) |
| view_ticket | `/ticket/:token` |
| view_order | `/events/:id` (confirmation block) |
| edit_rsvp | `/events/:id` (form collapsed, edit affordance) |
| closed | `/events/:id` (read-only) |

Every action in §4 ends with: refetch state → render `next_step` → optionally `navigate()` if URL differs. This unifies post-submit UX.

---

## 6. Capacity, Waitlist, Plus-Ones

**Invariants** (must hold after every transaction):

- I1: `count(rsvps WHERE event_id=E AND status='yes') ≤ events.capacity` (when capacity NOT NULL).
- I2: All `waitlisted` rows for an event have distinct `waitlist_position` values (gaps allowed; ordering matters, density doesn't).
- I3: A plus-one row's status equals its parent's status at all times.
- I4: A row with `payment_status='paid'` has a non-null `ticket_token`.
- I5: A row with `checked_in_at IS NOT NULL` has `payment_status='paid'`.

**Enforcement:**
- I1: enforced inside `safe_create_rsvp` advisory lock + count. **Action item:** add the lock if not already present (research did not confirm).
- I2: enforced by `promote_from_waitlist` re-rank.
- I3: requires a new trigger `sync_plus_one_status` on `rsvps` update (TODO).
- I4, I5: enforced by `mark_rsvp_paid` and `check_in_ticket` (in place).

**Capacity NULL:** treated as unlimited. `safe_create_rsvp` always returns `yes`. No waitlist row may exist for such an event — admin UI must hide the waitlist tab when capacity is NULL.

**`promote_from_waitlist` capacity bump** (`012`): the existing behavior of bumping capacity by 1 when admin promotes a "no-longer-fits" guest is **intentional and correct** — the admin has explicitly decided to expand the room. Document this in admin UI ("promoting will increase capacity from 30 → 31").

---

## 7. Notifications

### 7.1 Channel selection

```
guest.notification_preference   admin.sms_enabled   → channel sent
'sms'                           true                → SMS
'sms'                           false               → fallback to email if guest.email present, else suppress
'email'                         (any)               → email
'none'                          (any)               → suppress (still log with status='suppressed')
```

### 7.2 Idempotency

`notifications_log` gains a unique constraint:

```sql
ALTER TABLE notifications_log
  ADD COLUMN dedup_key TEXT,
  ADD CONSTRAINT notifications_log_dedup_unique UNIQUE (dedup_key);
```

`dedup_key` format: `<type>:<guest_id>:<event_id|null>:<bucket>` where `bucket` is:
- `rsvp_confirmation`: `<rsvp_id>:<status>` (a status change re-notifies; a re-submit does not).
- `order_confirmation`: `<order_id>`.
- `ticket_issued`: `<rsvp_id>:paid` (one per payment cycle).
- `waitlist_promoted`: `<rsvp_id>:promoted:<paid_at_or_null>`.
- `event_reminder`: `<event_id>:<reminder_offset>` (e.g. `24h`, `2h`).
- `event_update`: `<event_id>:<event.updated_at>` — re-publishing the event with no changes does not re-send.
- `invite`: `<invite_id>:<send_attempt_n>` (admin can explicitly resend, which increments `send_attempt_n`).

The `send-notification` edge function performs an `INSERT … ON CONFLICT (dedup_key) DO NOTHING RETURNING id`. If no row is returned, the send is skipped (already delivered).

### 7.3 Failure handling

Each row stores `status ∈ {queued, sent, failed, suppressed}` and `error`. On provider failure, the row stays as `failed` — retries are explicit (admin button or scheduled job), and use a different `dedup_key` (append `:retry:<n>`) so the retry actually goes out.

---

## 8. Mass Invite (future)

**Entry:** admin's `/admin/events/:id/invite` page, currently `EventBulkInvite.tsx`.

### 8.1 Inputs

- A list of recipients, each one of:
  - `{ email }` — preferred for bulk; SMS gets expensive.
  - `{ phone }` — only if `admin_settings.sms_enabled`.
  - `{ guest_id }` — re-invite an existing guest by id.
- Optional `message` override (admin's custom note appended to the templated body).
- Optional `cap`: `'rsvp'` (don't invite anyone already RSVP'd), `'all'`.

### 8.2 Validation (server-side, before any send)

For each recipient:
1. Normalize per §3.1.
2. Resolve to `guest_id` via `upsert_guest` (creates a guest row if new — this is desired so we have a contact target).
3. Reject the row if:
   - `guest.notification_preference = 'none'` AND no admin override.
   - Recipient is the cafe owner (admin's own contact).
   - Already invited to this event by this admin within the last 24h (use the §4.4 partial unique index; surface as "skipped: recently invited").
   - `cap='rsvp'` and `(guest, event)` already has an RSVP.
4. Group results into `{ to_send: [...], skipped: [{recipient, reason}] }`.

### 8.3 Preview & confirm

The page must display a **preview table** before any send fires:

| Recipient | Channel | Status |
|---|---|---|
| lina@… | email | will send |
| 555-1234 | sms | will send |
| omar@… | email | skipped — already RSVP'd |
| 555-9999 | sms | skipped — SMS disabled globally |

Admin clicks **Send N invites** to commit. No invites go out before this click.

### 8.4 Execution

- Each recipient is its own transaction:
  1. `INSERT … ON CONFLICT DO NOTHING` on `invites` (per §4.4 unique index) → either new row or existing row.
  2. Enqueue notification with `dedup_key = invite:<invite_id>:<send_attempt_n>`.
- Run with bounded concurrency (10 in flight) to avoid hammering Telnyx/Resend.
- Return a per-row result: `{ recipient, invite_id|null, notification_id|null, status: 'sent'|'failed'|'skipped', error?: string }`.

### 8.5 Resumability

- The bulk job inserts a `bulk_invite_jobs` row with the full recipient list and per-row status. The page polls (or subscribes) and renders progress. If the admin closes the page, the job continues; reopening reattaches.
- "Retry failed only" reissues just the rows with `status='failed'` (uses a new `send_attempt_n`).

### 8.6 Limits

- Hard cap **500 recipients per job** (configurable in `admin_settings.bulk_invite_max`). Beyond that, require multiple jobs — protects against runaway bills if a CSV is malformed.
- Per-day cap per event: **1500 invites**. Hit logs a warning and disables the button until next UTC day.

---

## 9. Mass Notification (future, distinct from invites)

Used for: event updates ("menu changed"), reminders ("tomorrow at 7"), broadcasts ("doors open at 6:30 tonight"), and ad-hoc admin messages.

### 9.1 Audience selectors

The admin chooses **one** audience per send:

| Selector | Set |
|---|---|
| `event:rsvp_yes` | `(event, status='yes')` ∪ paid waitlist |
| `event:rsvp_any` | all RSVPs except `no` |
| `event:waitlist` | `status='waitlisted'` |
| `event:paid` | `status='yes' AND payment_status='paid'` |
| `event:unpaid` | `status='yes' AND payment_status IN ('unpaid','pending') AND is_ticketed_event` |
| `event:checked_in` | `checked_in_at IS NOT NULL` (post-event thank-you) |
| `event:no_show` | `status='yes' AND payment_status='paid' AND checked_in_at IS NULL` (post-event only) |
| `all_guests` | every guest with `notification_preference != 'none'`. **Hard-gated** — requires typed confirmation. |

Selectors are evaluated **at send time**, never client-side. The same selector run twice produces the same `dedup_key` bucket, so accidental double-clicks are no-ops.

### 9.2 Pipeline (mirrors §8.4)

1. Resolve audience → list of `guest_id`.
2. For each: pick channel per §7.1, compose body from template + admin's variables.
3. `INSERT … ON CONFLICT (dedup_key) DO NOTHING` into `notifications_log`.
4. Send.

Templates live in `src/lib/notifications/templates/*.ts` and accept structured data (event title, guest first_name, time, etc.) — **no string interpolation in user-supplied admin text**. Admin's free-form note is rendered as a separate paragraph, escaped, never injected into URLs or templates.

### 9.3 Quiet hours

For SMS only: do not send between 21:00 and 09:00 in the cafe's timezone unless the type is `event_reminder` within 4 hours of doors. The edge function checks before send and queues the row with `status='queued'` and `send_after` for the next allowed window.

### 9.4 Suppression

A guest who replied `STOP` to an SMS or unsubscribed from email is permanently `notification_preference = 'none'` (set via webhook, not UI). The suppression log is append-only; even an admin cannot override.

---

## 10. Idempotency & Race Conditions

| Operation | Mechanism |
|---|---|
| `upsert_guest` | Match-then-write inside one statement; concurrent inserts on the same email/phone are serialized by the unique index (`guests_email_key`/`guests_phone_key`). On conflict, the second caller falls into the email/phone match branch on retry. |
| `safe_create_rsvp` | UPSERT on `(event_id, guest_id)`. Capacity check + insert must hold an advisory lock keyed on `event_id` to prevent two concurrent yes-RSVPs both passing the count check. **Action item: confirm/add `pg_advisory_xact_lock(hashtext('rsvp:'||event_id))` at top of the function.** |
| `safe_create_order` | No idempotency yet. Add `idempotency_key TEXT UNIQUE` column on `orders` populated client-side from a session UUID per cart. |
| `mark_rsvp_paid` | Already idempotent (no-op if `paid_at` set). |
| `check_in_ticket` | Already idempotent. |
| `safe_create_pickup_order` | Same as `safe_create_order` — needs idempotency_key. |
| Bulk invite/notification | Per-row dedup_key (§7.2) makes the entire job replayable. |

---

## 11. Action Items (deltas needed to satisfy this spec)

Tracked here so future work has a checklist; not all are blocking.

1. Hoist `normalizePhone` to `src/lib/utils/contact.ts`; replace duplicate copies in `RSVPForm.tsx` and `Order.tsx`.
2. Add `get_guest_event_state(event_id, guest_id)` RPC. Refactor EventDetail / Order / Ticket to consume it.
3. Migration: partial unique index on `invites` (§4.4).
4. Migration: `notifications_log.dedup_key` + unique constraint (§7.2).
5. Migration: `orders.idempotency_key` + `pickup_orders.idempotency_key` unique columns (§10).
6. Migration: `invites.consumed_by_guest_id`, `invites.send_attempt_n` columns (§4.4, §7.2).
7. Trigger: `sync_plus_one_status` to keep plus-one row aligned with parent (§6 I3).
8. `safe_create_rsvp`: block status change away from `yes` when `payment_status='paid'`; require admin refund first.
9. `safe_create_rsvp`: confirm advisory lock for capacity check.
10. Admin UI: bulk_invite_jobs table + page that supports preview/confirm/resume (§8).
11. Admin UI: mass notification composer with audience selectors (§9).
12. Webhook handlers for SMS `STOP` and email unsubscribe → set `notification_preference='none'`.

---

## 12. Decision Log (resolves research-flagged ambiguities)

| # | Ambiguity | Decision |
|---|---|---|
| 1 | Phone dedup is case-sensitive while email is not. | Both normalized client-side (§3.1); phone is E.164 so case is moot. Server does not re-normalize. |
| 2 | Invite target ≠ RSVP contact. | Allowed. We log `consumed_by_guest_id` for attribution, never block. |
| 3 | Notification re-sends on form re-submit. | Suppressed by `dedup_key` (§7.2). Admin can force resend by incrementing `send_attempt_n`. |
| 4 | Waitlist position gaps after status change. | Tolerated. Reranking happens lazily in `promote_from_waitlist`. |
| 5 | Order confirmation routing inconsistency. | Both Order and Pickup keep their current routing — Order stays in-page, Pickup navigates to `/pickup/:token`. Reason: pickup tokens are the durable bookmark; food orders for an event are reviewed via the event page. The `next_step` selector (§5) makes both consistent from the user's mental model: refresh either URL and you land on the right state. |
| 6 | Capacity NULL semantics. | Unlimited. No waitlisted rows may exist; admin UI hides waitlist for these events. |
| 7 | Plus-one status drift from parent. | Forbidden. Trigger keeps them aligned (§6 I3, §11 #7). |
| 8 | Paid RSVP changing to `no`. | Blocked at the RPC layer. Refund first, then status change. |
| 9 | Identity split when guest uses different channels in sequence. | Accepted; admin merges manually if needed. We do not fuzzy-match on names. |
| 10 | Reusable invite tokens. | Confirmed intentional. Tokens are convenience, not authentication. |
