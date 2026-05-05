# Notification Blast Feature — Spec

## Overview

Admins can send a one-time bulk notification ("blast") to attendees of a specific event. Each blast has separate copy for email and SMS so the message is appropriate for each channel, and always includes a link back to the event page. All sent blasts are stored and visible in a per-event history.

---

## Routes

| Path | Component |
|---|---|
| `/admin/events/:id/blast` | `AdminEventBlast` |

Accessible from the "Blast" button on every event card on the Dashboard (upcoming and past).

---

## Data Model

### Current: `notification_blasts`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `event_id` | `uuid` | FK → `events.id ON DELETE CASCADE` |
| `audience` | `text` | `'yes_only' \| 'yes_and_maybe' \| 'all_invited'` |
| `email_subject` | `text` | Subject line for email recipients |
| `email_body` | `text` | Plain text body; rendered into HTML template at send time |
| `sms_body` | `text` | Body for SMS recipients |
| `status` | `text` | `'pending' \| 'sending' \| 'sent' \| 'failed'` |
| `sent_count` | `int` | Successful deliveries |
| `failed_count` | `int` | Failed deliveries |
| `sent_at` | `timestamptz` | Null until send completes |
| `created_at` | `timestamptz` | Auto |

**RLS:** read and write restricted to `auth.role() = 'authenticated'` (admins only).

Every individual send is also logged to the existing `notifications_log` table with `type = 'notification_blast'`.

### Future additions (see planned features below)

| Column | Type | Notes |
|---|---|---|
| `scheduled_at` | `timestamptz` | When to send; null = send immediately |
| `draft` | `boolean` | True while saved but not yet submitted for send |

---

## Audience Options

| Value | Who receives it |
|---|---|
| `yes_only` | RSVPs with `status = 'yes'` |
| `yes_and_maybe` | RSVPs with `status IN ('yes', 'maybe')` |
| `all_invited` | All RSVPs regardless of status (`yes`, `maybe`, `no`, `waitlisted`) |

**Exclusions (always):**
- Plus-ones (`plus_one_of IS NOT NULL`) — they have no independent contact info
- Guests with `notification_preference = 'none'`
- Guests with no reachable channel (no email and no phone, or phone-only when SMS is globally disabled)

Deduplication by `guest_id` prevents double-sends if a guest has multiple RSVP rows.

---

## Notification Channels

Each guest receives the blast on their preferred channel:

1. If `notification_preference = 'sms'` AND global SMS is enabled AND guest has a phone → **SMS**
2. Else if guest has email → **Email**
3. Else if SMS is enabled AND guest has phone → **SMS** (fallback)
4. Otherwise → skipped (no reachable channel)

The **event URL** (`{site_url}/events/{event_id}`) is automatically appended to both channels — admins do not need to include it manually.

---

## Email Template

Blasts are sent as HTML using the existing Cafe Kadhem branded template:

- Header: "CAFE KADHEM" wordmark (small caps)
- Event title (italic serif) + event type if set
- Body: admin-entered text, with newlines converted to `<br>` so paragraph breaks are preserved
- Horizontal rules above and below the body text
- "View Event" CTA button linking to the event page
- Plain-text fallback: body + `\n\nDetails: {event_url}`

The template matches the style of existing transactional emails (RSVP confirmation, ticket issued, etc.).

---

## SMS Template

```
{sms_body}

{event_url}
```

The UI shows a character counter (160-char threshold) with a warning that going over will result in multi-segment delivery. The event URL is shown as a note next to the counter so admins know to budget for it.

---

## Edge Function: `send-blast`

**Auth:** Requires a valid Supabase session JWT in the `Authorization` header. Returns `401` if missing or invalid. This prevents any public caller from triggering a bulk send.

**Input:**
```json
{ "blast_id": "<uuid>" }
```

**Flow:**
1. Verify admin JWT
2. Fetch blast record (with joined event title/type)
3. Reject if `status` is already `'sending'` or `'sent'` (idempotency guard)
4. Set `status = 'sending'`
5. Fetch `admin_settings` for `sms_enabled` and `site_url`
6. Query `rsvps` filtered by `event_id`, audience statuses, and `plus_one_of IS NULL`, with guest details joined
7. For each unique guest: send via preferred channel, collect result
8. Batch-insert all results to `notifications_log`
9. Update blast record: `status`, `sent_count`, `failed_count`, `sent_at`

**Response:**
```json
{ "success": true, "sent": 42, "failed": 0 }
```

**Status logic:** if `sent_count = 0` and `failed_count > 0`, final status is `'failed'`; otherwise `'sent'`.

**Note on timeouts:** Edge functions have a ~150s limit. For typical event sizes (≤300 guests) this is not a concern. If future events grow significantly, the function would need to be refactored to paginate or use a queue.

---

## Admin UI

### Compose form (`/admin/events/:id/blast`)

- Back link → event edit page
- Event title + date in the page header
- **Audience selector** — three toggle buttons; shows live recipient count below (`"42 recipients will receive this blast."`)
- **Email subject** — single-line text input
- **Email body** — multi-line textarea (resizable); hint: "Event link appended automatically"
- **SMS body** — multi-line textarea (resizable); character counter `{n}/160`; warning appears when over 160 chars; hint: "Event link appended automatically"
- **Send button** — disabled until all three copy fields are non-empty; label shows recipient count (`"Send blast to 42"`); triggers native `confirm()` dialog before proceeding

### Previous blasts list

- Shown below the compose form, newest first
- Each blast renders as a collapsible card:
  - Collapsed: email subject, status badge (pending/sending/sent/failed), audience label, send timestamp, sent/failed counts
  - Expanded: full email body and SMS body in read-only sections
- Empty state: "No blasts sent yet for this event."

---

## Entry Points

- **Dashboard (upcoming events):** "Blast" ghost button alongside Edit / Orders / Invite / Waitlist
- **Dashboard (past events):** "Blast" ghost button alongside Edit / View (useful for post-event follow-ups)

---

## Planned Features

### Draft saving

The compose form currently has no persistence — navigating away loses in-progress copy. Drafts should auto-save so admins can step away and return.

**Proposed approach:**
- A blast row with `draft = true` is upserted to the DB on each keystroke (debounced ~1s), or on blur of each field
- On page load, if a draft exists for this event it pre-populates the form with a "Draft saved" indicator
- Clicking "Send" flips `draft = false` and triggers the edge function
- Only one draft per event is allowed at a time; a new compose always overwrites the previous draft

**Schema change:** add `draft boolean not null default false` to `notification_blasts`. The history list filters to `draft = false` so in-progress drafts don't appear there.

---

### Email preview

Admins should be able to see a rendered preview of the HTML email before sending.

**Proposed approach:**
- A "Preview email" button opens a modal with an `<iframe>` (or safe HTML render) of the fully assembled template using the current subject, body, and the event's actual title/type
- The preview is generated client-side using the same template function that the edge function uses (extract it into a shared utility or replicate it in a small preview helper)
- No network call required; the rendering happens in the browser

---

### Retry failed recipients

When a blast has `failed_count > 0`, the current UI shows the count but offers no remediation. A retry should attempt re-delivery to only the guests whose `notifications_log` entries for this blast have `status = 'failed'`.

**Proposed approach:**
- Add a "Retry failed" button on blast cards where `failed_count > 0`
- This creates a new blast record with the same copy and audience, but the edge function cross-references `notifications_log` for the original `blast_id` and only sends to guests whose prior attempt failed
- Alternatively, pass a `retry_of_blast_id` field to the edge function and let it compute the target set directly

---

### Scheduling

Blasts should optionally be scheduled to send at a future time (e.g. "morning of the event") rather than immediately.

**Proposed approach:**
- Add a `scheduled_at timestamptz` column to `notification_blasts`
- The compose form gets an optional datetime picker ("Send now" vs "Schedule for…"); a scheduled blast is inserted with `status = 'pending'` and `scheduled_at` set
- A cron job (Supabase scheduled function or external cron hitting an endpoint) runs every minute, queries for blasts where `status = 'pending' AND scheduled_at <= now()`, and invokes `send-blast` for each
- The history list shows scheduled blasts with a "Scheduled for [datetime]" label and a "Cancel" button (which deletes the row or sets `status = 'cancelled'`) as long as `sent_at` is null

---

### Unsubscribe / opt-out beyond `notification_preference`

The current opt-out mechanism is the global `notification_preference = 'none'` flag, which stops all notifications from the platform — not just blasts. There is no blast-specific unsubscribe.

**Proposed approach:**
- Add a `blast_opt_out boolean not null default false` column to the `guests` table
- Blast emails include a one-click unsubscribe link: `{site_url}/unsubscribe?t={token}` where the token resolves to a guest ID (using the same magic-link token pattern already in place)
- Hitting that endpoint sets `blast_opt_out = true` for the guest and shows a confirmation page
- The edge function skips guests where `blast_opt_out = true`
- The guest directory shows the flag so admins can see and reset it if needed

---

### Invite-table recipients for "all invited"

Currently "all invited" covers every guest with an RSVP row (any status). It does not include people who received an invite link but never RSVPd — they exist in the `invites` table with an `invited_email` or `invited_phone` but have no `guests` row.

**Proposed approach:**
- When `audience = 'all_invited'`, the edge function also queries the `invites` table for this event
- For each invite row with an `invited_email` or `invited_phone`, check whether a matching guest exists (join on email/phone); if a guest exists, they're already covered by the RSVP query; if not, send directly to the raw email/phone from the invite row
- The direct send skips the `notifications_log` guest_id FK (nullable) and uses `guest_id = null`; the invite token is noted in a separate field if logging granularity is needed
- This requires the email/SMS send helpers to accept raw contact info rather than always resolving through a guest row
