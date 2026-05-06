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
- **Cross-channel reconciliation** (merge / split / add a new channel): see §3.4 — the matching rules above are extended with explicit collision detection and a merge RPC.
- **Plus-one**: created via `add_plus_one()` only. Plus-one rows are NEVER returned from `upsert_guest` matching, because they have NULL contact (the function requires email or phone, see `020:43-49`).

### 3.3 Guest_id persistence in the browser

- After any successful `upsert_guest`, the page writes `localStorage.guest_id = id`.
- All subsequent RPCs in the session pass `p_guest_id` so step 1 of §3.2 fires — this prevents a guest who edits their email mid-session from being silently merged into a stranger's row.
- `localStorage.guest_id` is cleared by `/find-tickets` magic-link redemption (which sets it to the redeemed guest), and by an explicit "Not me" link on EventDetail so a shared device can re-identify.

### 3.4 Cross-channel reconciliation

The §3.2 match rules handle the common case (one channel, returning guest). Three additional cases need explicit handling so identity doesn't fragment over time.

#### Case A — Both channels submitted, mapping to two existing rows (auto-merge)

Strongest reconciliation signal possible: the user typed both their email and their phone in one form submission. If those two values resolve to **different** existing guest rows, we know they're the same person — the user just told us. Merge automatically, no verification.

`upsert_guest` extension:

```
if email is provided AND phone is provided:
  let row_e = SELECT id FROM guests WHERE lower(email) = lower(p_email) ORDER BY created_at DESC LIMIT 1
  let row_p = SELECT id FROM guests WHERE phone = p_phone ORDER BY created_at DESC LIMIT 1
  if row_e IS NOT NULL AND row_p IS NOT NULL AND row_e <> row_p:
    let keep = older(row_e, row_p)
    let drop = newer(row_e, row_p)
    PERFORM merge_guests(keep, drop)
    return keep with merged fields applied from p_fields
```

`merge_guests(keep_id, drop_id)` RPC (admin + SECURITY DEFINER, called inline from `upsert_guest`):

1. Reassign FKs from `drop_id` to `keep_id`: `rsvps`, `orders`, `pickup_orders`, `invites.invited_by`, `invites.consumed_by_guest_id`, `notifications_log.guest_id`, `magic_links.guest_id`, `ambient_tokens.guest_id`, plus-one parent links.
2. Conflict resolution: if both rows have an RSVP for the same event, keep the row with the more advanced status (`paid > yes > waitlisted > maybe > no`). Discard the other RSVP row (or move it to a `merged_rsvps_log` audit table — TBD).
3. Suppression: if either row has `notification_preference = 'none'`, the merged row inherits `'none'` (unsubscribe is sticky). Otherwise the more recent submission wins.
4. Field merge: copy non-null `keep` fields where `drop` has values `keep` doesn't (`first_name`, `last_name`, `instagram`).
5. `dedup_key` collisions in `notifications_log`: append `:merged` suffix to the dropped row's keys to avoid the unique constraint failing.
6. Delete `drop_id`. (Hard delete — FK constraints will surface anything we missed.)

The function is idempotent: calling it twice with the same args is a no-op after the first call (`drop_id` no longer exists).

#### Case B — One channel submitted, but it differs from the cached `localStorage.guest_id` (verify-then-merge)

E.g. localStorage holds guest_id=X (a phone-only row), the form submission is email-only and matches a different existing row Y. Possibilities: (1) X and Y are the same person who's adding a new channel, (2) X and Y are two different people sharing a device.

We can't auto-merge — we'd corrupt identity in case (2). Instead:

1. `upsert_guest` returns Y (the email match wins per §3.2 precedence) along with a `pending_merge: { from: X, to: Y, verification_token }` flag.
2. The page sends a **merge-verification magic link** to the email address (the channel that resolved to Y). Body: "Tap to confirm this is the same account you used before."
3. If clicked within 30 minutes → `merge_guests(older, newer)` runs. Done.
4. If not clicked → the verification token expires silently. localStorage is updated to Y. X stays as an orphaned phone-only row, recoverable later via Find Tickets.

This is the only place we send a verification step in the whole app, and it only fires when there's genuine ambiguity. Most guests never see it.

#### Case C — Adding a new channel to a known row (transparent)

E.g. recognized as guest X (email-only), the guest types a phone number that doesn't match any other existing row. No collision, no merge, no verification. `upsert_guest` updates X with the new phone (per the §3.2 field-merge behavior). This is the common case.

#### Resulting properties

- Engaged guests (anyone who's clicked a notification or used the recovery flow) have their identity reconciled the next time they fill out a form with both channels.
- The §3.2 "silent split" only persists for one-channel-only guests who never receive notifications and never use Find Tickets. That's acceptable; admin can still merge them manually.
- Merge is non-destructive in user-facing behavior: their RSVPs, tickets, orders, and history all survive on the canonical row.

---

## 3a. Recognition (no accounts)

> **Design stance.** No signup, no password, no profile screen, no "sign in" language anywhere in the public app. The guest record is a side-effect of doing something (RSVPing, ordering, being invited). Recognition is ambient: when we know who you are, we just use your name; when we don't, we ask once and remember.

### 3a.1 Three identity sources, in precedence

When any public page loads, it resolves `guest_id` in this order. The first hit wins:

1. **URL token** (strongest). Any of these tokens, present in the URL, identify the guest server-side:
   - `/invite/:token` → owner is `invites.invited_by`'s invitee record (or null until they RSVP).
   - `/ticket/:token` → owner is the RSVP's `guest_id`.
   - `/pickup/:token` → owner is `pickup_orders.guest_id`.
   - `/my-tickets?token=…` → magic-link redemption (`013_magic_links.sql`).
   - **Any transactional notification link** carries `?as=<short_magic_token>` appended automatically by `send-notification` (NEW, see §11). Clicking the email/SMS we sent you re-establishes identity — this is the dominant return path.
2. **`localStorage.guest_id`** (cache). Set on every successful `upsert_guest` and on every URL-token resolution. Read on every page load.
3. **Explicit identification form** (fallback). Email and/or phone fields on the page itself (the existing RSVP/Order forms). Submitting calls `upsert_guest` and writes localStorage.

### 3a.2 Magic links *are* identity

There is no separate auth system. A magic link is just a token row that maps to a `guest_id`. Two flavors:

| Token kind | Lifetime | Single-use? | Issued by |
|---|---|---|---|
| **Recovery magic link** (`/my-tickets?token=…`) | 30 min | yes | `/find-tickets` form, `find_guest_by_contact` edge fn |
| **Ambient identity token** (`?as=<token>` on any notification link) | 90 days | no, but rotates per send | `send-notification` edge fn |

The ambient token is a low-stakes recognition cookie disguised as a query param: it's enough to say "this is Lina, prefill her stuff" but it does NOT grant ticket access on its own (ticket access requires the `ticket_token`, which is a separate value). Even if a notification email is forwarded, the worst case is the new recipient is *recognized as Lina* until they identify themselves — they can't see her tickets without the ticket token, and they can't change her RSVP status because every mutation is also gated by RPC checks. (Practically, forwarded notifications are rare; this is the same trust model Partiful uses.)

### 3a.3 Recovery flow (`/find-tickets`)

The only place a returning guest types contact info to re-establish identity. Promoted from a hidden feature to a first-class button labeled **"I've been here before"** in the header on Home and EventDetail.

1. Guest enters email or phone.
2. `find_guest_by_contact` edge fn: looks up by §3.2 precedence; if no match, says "we don't have you yet — just RSVP and we'll remember you" (no error, no account-creation friction).
3. If matched: send a **recovery magic link** to the channel that matched (email or SMS). Body: "Tap to pick up where you left off."
4. Guest taps. `/my-tickets?token=…` redeems via `redeem_magic_link`, sets `localStorage.guest_id`, lands on a personalized "Your stuff" view (upcoming RSVPs, tickets, pickup orders, history).
5. From there, every subsequent page on this device is silently authenticated.

**No 6-digit code path.** The link click is the verification. If the guest is on the same device that received the SMS/email, the round-trip is one tap.

### 3a.4 The "Not me" affordance

When a guest is recognized (we have a `guest_id` and a `first_name` for them), every public page header shows: **"Hi, Lina · not you?"**. Clicking *not you?*:

1. Clears `localStorage.guest_id`.
2. Strips any `?as=` from the URL.
3. Reloads the page in anonymous mode.

This is the only "log out" surface. There is no log-in surface; identification re-happens organically on the next form submit or notification click.

### 3a.5 Local persistence rules

- `localStorage.guest_id`: long-lived, never expires unless explicitly cleared. Survives across sessions, browser restarts, app updates.
- No other PII in localStorage. We re-derive `first_name` and contact prefill from the server on each load via `get_my_guest()` (already exists).
- **Multiple guests on one device** (household): the "Not me" link handles this. The first person RSVPs and is cached; the second person clicks "not you?", types their own contact, and the cache flips. We do not try to support concurrent identities on one device.

### 3a.6 Channel choice: SMS vs. email

Both channels carry magic links and notifications. The choice is per-guest (`notification_preference`) and per-event-type:

- **Default channel for transactional sends** (RSVP confirm, order confirm, ticket issued, recovery): whichever the guest provided. If they gave both, follow `notification_preference`; if `'sms'` and SMS is globally disabled, fall back to email (§7.1 already covers this).
- **SMS is reserved for time-sensitive sends** once 10DLC clears: day-of reminders, doors-open nudges, "we're starting" pings. Everything else defaults to email even for SMS-preferring guests, to control cost and STOP-rate. (Implement as a per-`type` channel override table in `send-notification`.)
- **Email-only is fine.** The system never requires a phone number. The only flows that *need* SMS are the day-of reminders, and those degrade gracefully to email.

### 3a.7 Use-case walkthroughs

Each row is one realistic guest journey. "Recognized" means a `guest_id` was resolved by §3a.1; "anon" means none of the three sources hit and the guest sees blank fields.

#### A. First-time guest, direct event link (no invite)

> Lina sees the event posted on Instagram, taps the link.

1. Lands on `/events/:id`. No URL token, no localStorage → **anon**.
2. Sees event flyer, "Reserve a Seat" button.
3. Taps RSVP → form expands with empty fields.
4. Fills name + email, taps yes.
5. `upsert_guest` (insert) → `guest_id`. `safe_create_rsvp` → status `yes` (or waitlisted). `localStorage.guest_id` set.
6. Confirmation shows "Hi Lina, you're in. We'll email you reminders."
7. Confirmation email goes out with `?as=<token>` on every link inside it.
8. Done.

#### B. First-time guest, invited by a friend

> Omar texts Lina an invite link from his RSVP page.

1. Lina taps the SMS link → `/invite/:token`.
2. `InviteLanding` resolves the invite token server-side, gets `event_id` and `invited_by` (Omar's first_name).
3. Redirects to `/events/:id` with router state. The page also caches a **provisional** identity: it knows the invite was sent to `lina@…` (or her phone), so it pre-fills that field. **No `guest_id` yet** — we don't auto-create the guest until she actually submits, because she might decline.
4. Banner: "Omar invited you. Reserve a seat?"
5. She taps yes. `upsert_guest` matches her existing email if she's been here before, else inserts. `safe_create_rsvp` runs.
6. `invites.consumed_by_guest_id` is set to Lina's `guest_id` (attribution).
7. From here identical to A.

#### C. Returning guest, same device

> Lina comes back two weeks later, taps a new event link from Instagram.

1. `/events/:id` loads. No URL token, but **localStorage.guest_id** is set from her last visit → **recognized**.
2. Page calls `get_my_guest()` → returns `{ first_name: 'Lina', email, phone, notification_preference }`.
3. Header shows "Hi, Lina · not you?".
4. RSVP form is collapsed by default; the visible state is "Reserve a Seat" with one tap.
5. She taps. The form is already pre-filled from step 2 — she just confirms status (yes/maybe/no) and submits. One tap RSVP, two if she changes her mind about plus-one.
6. Done.

#### D. Returning guest, new device (or cleared cookies)

> Lina got a new phone. Taps an Instagram event link.

1. `/events/:id`, no token, no localStorage → **anon**, same as A.
2. Header shows a small "I've been here before" link.
3. She taps it → `/find-tickets`.
4. Enters her email. `find_guest_by_contact` finds her. Magic link sent.
5. She switches to her email, taps the link → `/my-tickets?token=…`.
6. `redeem_magic_link` runs, `localStorage.guest_id` set.
7. Lands on "Your stuff" — sees upcoming events she's RSVP'd to, past tickets.
8. Taps the new event → `/events/:id` is now in **recognized** mode (path C).

#### E. Returning guest, taps the email/SMS link directly

> Lina got a "doors open in 30 min" reminder text. Taps the link.

1. URL is `/events/:id?as=<short_magic_token>`.
2. Page resolves the `as` token server-side → `guest_id`. Sets localStorage. Strips the param from the URL (history.replaceState).
3. Recognized, same as C — but she didn't have to do anything.
4. This is the dominant return path for engaged guests; D is the fallback.

#### F. Lost ticket the morning of the event

> Lina deleted the email. Needs the QR code at the door.

1. She lands on `/find-tickets` (link in event detail page footer, also in any prior email she has).
2. Enters phone or email → magic link sent.
3. Taps → `/my-tickets?token=…` → sees her ticket → taps it → `/ticket/:ticket_token` → QR.
4. Could also be done by admin at the door: scan a backup QR she shows from her email confirmation.

#### G. Mass-invited (admin sends bulk invite)

> Admin uploads 80 contacts to invite to next month's event.

1. For each recipient, admin's bulk-invite job calls `upsert_guest` (creates a guest row if new — they don't have to RSVP for the row to exist) and inserts an `invites` row.
2. Each invite SMS/email contains `/invite/:token` plus `?as=<their_ambient_token>`.
3. When the invitee clicks: `as` token recognizes them (so the form is pre-filled), AND the invite token attributes Omar→Lina-style (so the banner says "Cafe Kadhem invited you"). Two tokens on one URL is fine — they answer different questions.
4. Same path as B from there.

#### H. Household / shared device

> Lina RSVP'd from the family iPad. Now her partner Noor wants to RSVP from the same iPad.

1. Page loads, recognizes Lina (header: "Hi, Lina · not you?").
2. Noor taps "not you?". localStorage cleared → **anon**.
3. Form is empty. Noor enters his name + email, RSVPs. localStorage now holds Noor's `guest_id`.
4. Next visit on this iPad recognizes Noor by default. Lina taps "not you?" when it's her turn.
5. **Limitation:** there is no "switch between Lina and Noor" UI. Always-anonymous → identify is the only state transition. Acceptable per Partiful conventions; if it becomes painful, we add a "recently used" picker later.

#### I. Plus-one (no separate identity)

> Lina is bringing her brother Sami.

1. Lina RSVPs yes, ticks "+1", types "Sami" as the plus-one name.
2. `add_plus_one` creates a stub guest row (no email/phone), linked to Lina's RSVP.
3. Sami has no notifications, no recognition, no recovery — he's just a name attached to Lina. If he later wants his own identity (e.g. to RSVP separately for a future event), he goes through path A and gets his own row. The plus-one stub is never reconciled with that row; they're separate records by design.

#### J. Returning guest who used phone last time, now types email-only

> Lina RSVP'd by phone last summer. Today she types her email on a new device.

1. `/events/:id`, anon. She types her email and RSVPs.
2. `upsert_guest` email lookup misses (her existing row has phone but no email). Phone lookup also misses (she didn't type one). Inserts a **new row**.
3. Identity splits silently. (See §3.2.) She's now two records.
4. **Mitigation:** the recovery flow (path D) prevents this from happening to engaged guests, because returning guests who use Find Tickets get magic-linked back into their original row. The split only happens to guests who skip that and re-identify via the form. Acceptable for now; admin manual merge in Guest Directory if it matters.

#### K. Anonymous spectator (no action)

> A friend forwards an event link. The recipient looks but doesn't RSVP.

1. `/events/:id`, anon. Sees event, flyer, public attendee list (first names + Instagram handles only, per `public_guest_profiles`).
2. Closes tab. No record created.
3. This is the only path that produces no guest row, and that's correct — we don't want passive viewers cluttering the directory.

### 3a.8 Sharing as a first-class affordance

The notification system necessarily attaches `?as=` ambient tokens to every link it sends. If a guest forwards that email/SMS to a friend, the friend's first page load would briefly recognize them as the original recipient (see §3a.2 trust model). Mitigation: make sharing **easier than forwarding**, so forwarding becomes the rare path.

#### Placement

A prominent **Share** button appears in three places:

1. **Post-RSVP confirmation card** (RSVPForm.tsx after successful submit). Primary CTA-styled, sits next to "View your details" or below the success summary. Copy: *"Tell your friends"*.
2. **EventDetail header**, visible to any recognized guest who has RSVP'd `yes` (so the sharer is committed to attending). For non-RSVP'd or anon viewers, no share button — they should RSVP first or recognize themselves first.
3. **Ticket page** (`/ticket/:token`) — small "Invite a friend" link below the QR. Useful for paid events where ticket holders sometimes want to bring others.

#### Share URL shape

The URL produced by Share **never contains an `?as=` token** under any circumstance. It is one of:

- `https://cafekadhem.com/events/:id` — plain event link (default).
- `https://cafekadhem.com/events/:id?ref=<inviter_guest_id>` — soft attribution: when the recipient RSVPs, set `rsvps.referred_by_guest_id = <inviter_guest_id>`. This is **not** the same as creating an `invites` row; it's a lightweight "Lina sent you" attribution that doesn't require a per-recipient invite token. (NEW column, see §11.)
- `https://cafekadhem.com/invite/:token` — full invite path: only when the inviter explicitly enters a friend's email/phone via `InviteForm` (existing flow). This still creates an invite row and sends a notification to the friend, separate from sharing.

The Share button's default action produces the `?ref=` form. The plain form is the fallback for guests with no `guest_id` (rare — they'd have to be sharing without RSVPing, which we don't expose).

#### Mechanism

1. Tap Share → check `navigator.canShare()`.
2. If supported (mobile): call `navigator.share({ title: event.title, text: "I'm going to <event> at Cafe Kadhem — want to join?", url })`. The OS sheet handles routing to Messages, WhatsApp, IG DMs, etc.
3. If not supported (desktop): open a small popover with three buttons: **Copy link**, **Email**, **Text**. Each prefills the appropriate handler with the same URL.
4. No backend call. Sharing produces no record until the recipient acts on the link.

#### Why this works

- Forwarding raw notification emails is *technically* possible but requires opening the email client, hitting forward, retyping the recipient — friction.
- Sharing is one tap from the confirmation card right when excitement is highest.
- The shared URL contains no identity token, so the recipient is correctly anonymous on arrival, sees the event, and identifies themselves through the normal flow.
- The `?ref=` parameter gives admin a clean attribution graph ("who's bringing whom") without any privacy cost — `ref` is a guest_id, not a contact, and only matters server-side.

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
- **Status change yes → no on a paid RSVP**: blocked at the server (migration 033 raises `paid_rsvp_cannot_change_status`). Guest sees a generic error toast and is expected to contact the host out-of-band for a refund. *(A UI guard that pre-disabled Maybe/Decline was tried in Commit 5 and reverted — marginal UX value didn't justify the surface area.)*
- **Lost ticket**: guest uses Find Tickets (§4.6) with their phone/email; magic link returns the token.

### 4.4 Invite (single)

**Create** (`InviteForm.tsx`):
- Inviter must be a recognized guest (per §3a.1). If anon, the inline "I've been here before" link or a one-field identification step runs first — no separate "sign in" page.
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

> **Implementation status:** the selector RPC ships in migration 029 (hot-fixed in 035) and the `useGuestEventState` React hook in Commit 5. Existing pages (EventDetail, Order, Ticket, Pickup) **still infer state locally as of this writing** — they each get the right answer, but not from the canonical RPC. The full migration of those pages to consume the hook is a tracked-but-deferred cleanup; see `docs/IMPLEMENTATION_PLAN.md` decision log #4. New state-aware pages should consume the hook directly.

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

**Schema.** `guests.notification_preference` ∈ `{'sms', 'email', 'both', 'none'}`. The `'none'` value is system-set only (STOP webhooks, email unsubscribe) and never appears as a user-choosable option. The `'both'` value is added in a new migration (extend the existing enum / check constraint).

**Inferred from fields, not chosen.** The public-facing forms (RSVP, Order, Pickup, InviteForm) **do not** show a channel-preference dropdown. Preference is inferred at `upsert_guest` time from which channels the guest provided:

| Provided fields | Inferred preference |
|---|---|
| email + phone | `'both'` |
| phone only | `'sms'` |
| email only | `'email'` |

Inference only fires when the guest is being created or when their existing preference is `null`. If a guest already has an explicit preference (set via `/my-tickets` settings or admin override), respect it — adding a second channel does not silently change their preference.

**SMS is the default channel for new guests when both fields are filled.** With 10DLC approved, a guest who gives both email and phone receives transactional sends via SMS by default; "both" means SMS for time-sensitive sends (reminders, doors-open, ticket issued) and email for bulkier or less urgent sends (event updates, post-event recaps). The per-`type` channel routing table lives in `send-notification`:

| Notification type | Preferred channel when `pref='both'` |
|---|---|
| `rsvp_confirmation` | SMS |
| `ticket_issued` | SMS |
| `order_confirmation` | email (longer body, item list) |
| `pickup_order_confirmation` | email |
| `invite` | SMS (more likely to be seen) |
| `event_reminder` (24h, 2h) | SMS |
| `event_update` | email |
| `waitlist_promoted` | SMS |

**Resolution table:**

```
preference   admin.sms_enabled   → channel sent
'sms'        true                → SMS
'sms'        false               → email fallback if email present, else suppress (log status='suppressed')
'email'      (any)               → email
'both'       true                → per type-routing table above
'both'       false               → email
'none'       (any)               → suppress (log status='suppressed')
```

**Admin override.** The Guest Directory exposes the preference as a select for any single guest (sms / email / both / none). This is the canonical way to handle a guest who calls in saying "stop texting me but keep emailing" — admin sets `'email'` directly.

**Self-service.** `/my-tickets` "Your stuff" page exposes the preference for the recognized guest. They can switch between sms / email / both. They cannot pick `'none'` from the UI — that requires replying STOP or clicking the email unsubscribe link, both of which are also link-based magic-link flows that prove channel ownership.

**Consent copy.** Every public form that captures contact info (RSVP, Order, Pickup, Invite) renders this fine print directly under the submit button — visible at the moment of submission, not behind a modal:

> By RSVPing, you agree to receive SMS and/or email from Cafe Kadhem for event invites, reminders, tickets, and order updates. Reply STOP to opt out of SMS at any time.

The exact text is centralized in `src/lib/notifications/consent.ts` so 10DLC compliance copy can be updated in one place. The verb adapts per form: "By RSVPing", "By placing your order", "By inviting a friend", "By placing a pickup order".

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
2. Add `get_guest_event_state(event_id, guest_id)` RPC. *(Done in migration 029, fixed in 035. Hook `useGuestEventState` shipped in Commit 5.)* **Refactor EventDetail / Order / Ticket to consume it: deferred** — see `docs/IMPLEMENTATION_PLAN.md` decision log #4. Pages already implement the §5 decision tree correctly per-page; full rewrite would produce zero behavior diff but carry regression risk. Adopt the hook in any *new* state-aware page; refactor an existing one only if a real divergence bug surfaces.
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
13. Migration: `ambient_tokens` table (or extend `magic_links` with `kind` column) — `(token, guest_id, expires_at, kind)`. Long-lived (90 days), rotated per send.
14. `send-notification` edge fn: append `?as=<ambient_token>` to every link in the rendered email/SMS body. Token lookup endpoint resolves to `guest_id` and sets localStorage on page load.
15. Add `get_my_guest()` consumer logic to `PublicLayout` so every page header reflects recognition state ("Hi, Lina · not you?").
16. Promote `/find-tickets` UX: add "I've been here before" link to Home and EventDetail headers, rename page copy away from "Find tickets" to "Pick up where you left off" (the page already does more than tickets).
17. EventDetail: when invited via `/invite/:token`, prefill the contact field that matches `invited_email` or `invited_phone` (provisional identity, no `guest_id` written until RSVP submit).
18. Migration: `merge_guests(keep_id, drop_id)` RPC — admin + SECURITY DEFINER. FK reassignment across rsvps, orders, pickup_orders, invites, notifications_log, magic_links, ambient_tokens. Conflict resolution per §3.4 Case A. Idempotent.
19. Extend `upsert_guest`: detect dual-channel collision (Case A) → call `merge_guests` inline; detect single-channel collision against `localStorage.guest_id` (Case B) → return `pending_merge` payload with a verification token.
20. Migration: extend `notification_preference` enum/check to include `'both'`. Backfill: any existing guest with both `email` and `phone` populated and `notification_preference IN (NULL, 'sms', 'email')` → leave existing preference alone (don't silently change preferences for known users).
21. Remove the channel-preference dropdown from RSVPForm, Order, Pickup, InviteForm. Preference is now inferred from filled fields. Keep the dropdown only on `/my-tickets` settings.
22. Update `send-notification` edge fn: implement the per-type channel routing table (§7.1) for guests with `preference='both'`.
23. Add `<ConsentNote>` component (`src/lib/notifications/consent.ts` + component) rendered under every public submit button. Verb adapts per form context.
24. Add `<ShareButton>` component. Renders `navigator.share()` on mobile, copy/email/text popover on desktop. Placement: post-RSVP confirmation, EventDetail header (if `rsvp='yes'`), Ticket page.
25. Migration: `rsvps.referred_by_guest_id UUID REFERENCES guests(id)` — soft attribution from `?ref=<guest_id>` share URLs. Captured at RSVP creation, not edited later.
26. Mark `admin_settings.sms_enabled = true` in production seed/config (10DLC approved as of 2026-05).

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
| 9 | Identity split when guest uses different channels in sequence. | Mitigated by §3.4: dual-channel auto-merge (Case A), verify-then-merge for single-channel collision (Case B). Residual splits only affect guests who use one channel forever and never receive notifications; admin merge remains the manual fallback. |
| 10 | Reusable invite tokens. | Confirmed intentional. Tokens are convenience, not authentication. |
