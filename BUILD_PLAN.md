# Cafe Kadhem — Build Plan & Status

> **Last updated:** 2026-05-02 (ticketing added)
> Living document tracking progress against the original build plan. Annotated with `[DONE]`, `[CHANGED]`, `[ADDED]`, `[PARTIAL]`, and `[TODO]` markers.

---

## Project Overview

Full-stack event management web app for Cafe Kadhem (كافيه كاظم), an apartment cafe that hosts intimate food events. Owner creates events with menus and flyers; guests RSVP, pre-order food, and pay via Venmo deep links.

**Design reference:** warm cream backgrounds, deep forest green text and accents, elegant serif headers with clean sans-serif body text, hand-drawn illustrations, calligraphy-style flourishes. Mobile-first. No emojis.

---

## Tech Stack

| Layer | Technology | Status |
|---|---|---|
| Frontend | React (Vite), TailwindCSS, deployed to Netlify | `[DONE]` |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions, Realtime) | `[DONE]` |
| SMS | Telnyx API (abstracted behind a provider interface) | `[DONE]` |
| Email | Resend | `[DONE]` |
| Payments (Phase 1) | Venmo deep links | `[DONE]` |
| Payments (Phase 2) | Stripe integration | `[TODO]` |

---

## Architecture Principles

1. `[DONE]` Supabase RLS on every table.
2. `[DONE]` Edge Functions for sensitive operations (SMS, admin mutations).
3. `[DONE]` No PII leakage — `public_guest_profiles` view exposes only `id`, `first_name`, `instagram`.
4. `[DONE]` Payment abstraction layer (`PaymentProvider` interface, `VenmoProvider` implementation).
5. `[DONE]` SMS/notification provider abstraction (`NotificationProvider` interface with Telnyx + Resend).
6. `[DONE]` Mobile-first responsive design.
7. `[DONE]` Environment variables for all secrets and config.

---

## Database Schema

### `[DONE]` admin_settings
Implemented as specified, with these `[CHANGED]` items:
- `[CHANGED]` Removed `cafe_name` column (unused — name is hardcoded in branding).
- `[ADDED]` `theme` column to support theme switching (theme1/theme2).

### `[DONE]` events
- All originally-planned fields implemented.
- `[ADDED]` `location_name` — optional label split from `location` address.
- `[ADDED]` `home_flyer_url` — separate optional flyer used on the home page card vs. the full flyer on the detail page.
- `[ADDED]` `gathering_number` — sequential event counter.

### `[DONE]` menus, menu_items
Implemented as specified.

### `[DONE]` guests
Implemented as specified, including the `contact_required` check constraint and `notification_preference` enum (sms/email/none).

### `[DONE]` rsvps
Implemented with capacity enforcement via `safe_create_rsvp()` Postgres function.
- `[ADDED]` `waitlisted` status (in addition to yes/maybe/no).
- `[ADDED]` `waitlist_position` and `waitlisted_at` columns for ordered waitlisting.
- `[ADDED]` `promote_from_waitlist()` admin function.

### `[DONE]` orders, order_items
Implemented as specified. `payment_method` allows `venmo` or `stripe` (Stripe stub only).

### `[DONE]` invites
Implemented as specified — opaque 32-char hex tokens.

### `[DONE]` notifications_log
Implemented as specified.

### `[DONE]` public_guest_profiles view
Read-only view exposing only `id`, `first_name`, `instagram`. Used by all public guest list queries.

### `[ADDED]` Ticketing
Optional paid ticket flow on top of any event:
- `events.ticketing_enabled` + `events.ticket_price` toggle ticketing per event.
- `rsvps.payment_status` (`unpaid`/`pending`/`paid`/`refunded`), `ticket_token`, `paid_at`, `checked_in_at`.
- RPCs: `mark_payment_pending` (guest self-mark after Venmo), `mark_rsvp_paid` (admin verifies + issues token), `mark_rsvp_unpaid` (undo), `get_ticket(token)` (public read-by-token), `check_in_ticket(token)` (door scan, authenticated), `undo_check_in`.
- Public `/ticket/:token` page renders guest name + QR code of the same URL.
- Admin payments queue at `/admin/events/:id/tickets` with pending/unpaid/paid filter, mark-paid and re-send actions.
- Admin door scanner at `/admin/events/:id/checkin` using `html5-qrcode` plus a name-search manual fallback.
- Notification templates: `ticket_payment_received` (auto-sent when guest taps "I've Paid"), `ticket_issued` (sent when admin marks paid).

### `[ADDED]` Pickup Order System
New tables for an out-of-event ordering flow:
- `pickup_config` — global pickup settings.
- `pickup_slots` — admin-defined day/time slots.
- `pickup_orders`, `pickup_order_items` — orders against pickup slots.

### Migrations Inventory
9 migrations applied covering: initial schema + RLS, waitlist, gathering number, admin settings cleanup, pickup system, home flyer URL, theme support, theme migration, location split.

---

## Sitemap & Page Specifications

### Public Pages

| Route | Status | Notes |
|---|---|---|
| `GET /` Home | `[DONE]` | Upcoming + past events, RSVP counts, branding header (English + Arabic) |
| `GET /events/:id` Event Detail | `[DONE]` | Flyer, info, donation info, RSVP form, public RSVP list, share, inline menu |
| `GET /events/:id/order` Pre-Order | `[DONE]` | Quantity selector, Venmo deep link, confirmation screen |
| `GET /invite/:token` Invite Landing | `[DONE]` | Token validation, invited-by context, redirect to event |
| `[ADDED]` `GET /pickup` | `[DONE]` | Standalone pickup order flow with date + slot selection (hidden until activated by admin) |

### Admin Pages (auth-protected)

| Route | Status | Notes |
|---|---|---|
| `GET /admin/login` | `[DONE]` | Email + password auth |
| `[ADDED]` `GET /admin/forgot-password` | `[DONE]` | Email-based reset request |
| `[ADDED]` `GET /admin/reset-password` | `[DONE]` | Token-validated password reset |
| `GET /admin` Dashboard | `[DONE]` | Event + pickup summaries, quick links |
| `GET /admin/events/new` Create Event | `[DONE]` | All fields + flyer + home flyer uploads |
| `GET /admin/events/:id/edit` Edit Event | `[DONE]` | "Send Update" notification supported |
| `GET /admin/events/:id/orders` Event Orders | `[DONE]` | Payment status toggle, CSV export |
| `[ADDED]` `GET /admin/events/:id/waitlist` | `[DONE]` | Manage waitlist, manually promote |
| `GET /admin/menus` Menu Library | `[DONE]` | List, edit, duplicate, delete |
| `GET /admin/menus/new` / `:id/edit` | `[DONE]` | Items with images, categories, sort order |
| `GET /admin/guests` Guest Directory | `[DONE]` | Searchable, sortable, history view, CSV export |
| `GET /admin/settings` | `[DONE]` | Venmo handle, contact email, theme picker (live preview) |
| `[ADDED]` `GET /admin/pickup-config` | `[DONE]` | Configure pickup slots by day/time |
| `[ADDED]` `GET /admin/pickup-orders` | `[DONE]` | View/manage pickup orders |

---

## Notification System

`[DONE]` Architecture: `NotificationService` with `sendSMS`, `sendEmail`, `notifyGuest`. Telnyx + Resend providers behind interfaces. All notifications go through the `send-notification` Edge Function. Every attempt logged to `notifications_log`.

### Notification Types

| Type | Status | Notes |
|---|---|---|
| RSVP confirmation | `[DONE]` | |
| Order confirmation | `[DONE]` | |
| Event update | `[DONE]` | Triggered by admin "Send Update" |
| Event reminder | `[PARTIAL]` | Template + send logic exist; **no scheduler/cron yet** |
| Invite | `[DONE]` | Email or SMS based on input |
| `[ADDED]` Waitlist promoted | `[DONE]` | Sent when admin promotes a guest off the waitlist |

---

## Payment System

### Phase 1: Venmo Deep Links — `[DONE]`
- Mobile (`venmo://paycharge`) + web fallback (`https://venmo.com/...`).
- Note format: `{FirstName} - {EventTitle}`.
- Venmo handle pulled from `admin_settings`.
- Manual payment status toggle by admin.

### Phase 2: Stripe — `[TODO]`
- `PaymentProvider` interface already defined and `VenmoProvider` implements it. Adding `StripeProvider` will not require touching call sites.
- Schema supports `payment_method = 'stripe'` already.
- Not implemented: Stripe SDK, webhook handler, payment intent UI, status auto-updates.

---

## Security Considerations

| # | Item | Status |
|---|---|---|
| 1 | RLS on every table | `[DONE]` |
| 2 | Guest token in localStorage (convenience, not auth) | `[DONE]` |
| 3 | Opaque 32-char hex invite tokens | `[DONE]` |
| 4 | Rate limiting on Edge Functions (10 RSVP/min, 5 invite/min per IP) | `[DONE]` |
| 5 | Input sanitization (XSS) | `[DONE]` |
| 6 | File upload validation (type + size) | `[DONE]` |
| 7 | Admin route protection via Supabase Auth | `[DONE]` |
| 8 | No service role key on the client | `[DONE]` |
| 9 | CORS locked to production domain | `[DONE]` |
| 10 | Env vars for all secrets | `[DONE]` |

---

## Guest Identity & Returning Visitors

`[DONE]` Implemented as specified:
- `cafe_kadhem_guest_token` in localStorage maps to `guest_id`.
- Returning-visitor pre-fill, dedup by email/phone on RSVP, graceful handling of token loss.

---

## Sharing & Invites

`[DONE]` All flows implemented:
- Share link with Web Share API + clipboard fallback.
- Direct invite via email or SMS through `send-invite` Edge Function.
- Admin invites from guest directory.
- `/invite/:token` landing with invited-by context.

---

## Phased Delivery

### Phase 1 — Core (`[DONE]`)
All Phase 1 line items complete:
- Supabase project setup, all tables, RLS, views, storage buckets.
- Admin auth (single user) — extended with `[ADDED]` forgot/reset password flows.
- Admin event/menu CRUD + flyer uploads + settings.
- Public homepage, event detail, RSVP, public RSVP list.
- Pre-order flow with Venmo deep link.
- Admin orders, payment status, CSV export.
- Guest directory.
- Share + direct invite.
- Notifications: RSVP confirmation, order confirmation, event update via SMS (Telnyx) and email (Resend).

### Phase 2 — Enhancements (mostly `[TODO]`)
| Feature | Status |
|---|---|
| Stripe integration | `[TODO]` |
| Live ordering during events (Supabase Realtime) | `[TODO]` |
| Event reminders (cron / pg_cron 24hr before) | `[PARTIAL]` — templates done, scheduler missing |
| Guest accounts (OAuth) | `[TODO]` |
| Analytics dashboard | `[TODO]` |
| Waitlist management — auto-promote from 'maybe' when capacity opens | `[PARTIAL]` — manual admin promotion implemented; auto-promote not built |

---

## `[ADDED]` Features Not in Original Plan

These were built in addition to the original spec:

1. **Theme switching system** — Two full visual themes selectable from admin settings:
   - **Theme 1 (Archival):** original cream + forest green editorial serif look.
   - **Theme 2 (Poster):** Sailors Condensed / Anton display face, ultramarine + faded sage palette, vertical stripe page backdrop.
   - Theme stored in `admin_settings.theme`; cascade via `data-theme` attribute and CSS custom properties.
2. **Pickup order system** — Standalone ordering flow outside events:
   - `/pickup` public page (hidden until admin activates).
   - Admin pickup config (slot definitions by day/time) and pickup orders dashboard.
   - Reuses Venmo payment + notification stack.
3. **Waitlist** — Automatic placement on waitlist when capacity full, ordered by `waitlist_position`, with manual admin promotion + waitlist-promoted notification.
4. **Forgot/reset password flows** — Beyond just admin login.
5. **Separate home-page flyer image** (`home_flyer_url`) — distinct from the detail-page flyer.
6. **Location name + address split** — optional venue name displayed alongside the address.
7. **Gathering number** — sequential event counter for branding/identity.

---

## `[CHANGED]` From Original Plan

1. **`admin_settings.cafe_name` removed** — name is hardcoded in branding; the column was unused.
2. **RSVP statuses extended** with `waitlisted` (originally only yes/maybe/no).
3. **US phone normalization** — phone validation tightened to NANP, with formatted display.
4. **Theme-controlled UI** — Pick-Up link and other elements gated behind admin theme/feature toggles rather than always visible.

---

## What's Left To Complete

### Must-have to fully close Phase 1
- `[TODO]` **Event reminder scheduler.** Templates and send logic exist; need a Supabase cron job (pg_cron) or external scheduler that triggers `send-notification` 24 hours before each published event.

### Phase 2 (deferred, in priority order)
1. `[TODO]` **Stripe payment provider** — implement `StripeProvider` against existing `PaymentProvider` interface, add webhook Edge Function, auto-update `orders.status`.
2. `[TODO]` **Auto-promote from waitlist** — trigger or Edge Function that promotes the next waitlisted RSVP when a 'yes' RSVP is cancelled or capacity is increased.
3. `[TODO]` **Live ordering / real-time queue** — Supabase Realtime subscription on `orders` for an admin event-day view.
4. `[TODO]` **Analytics dashboard** — popular items, repeat guests, revenue trends.
5. `[TODO]` **Guest accounts** — optional sign-up with OAuth (Google/Apple) for returning guests.

### Quality / polish
- `[TODO]` Confirm CORS lockdown to production domain in Supabase + Netlify env once domain is finalized.
- `[TODO]` Consider an optional `preorder_cutoff` timestamp on events (mentioned in original notes — not yet implemented).
- `[TODO]` Image thumbnail generation for flyers (currently serving full-size images everywhere).

---

## File Structure (current)

Matches the originally-planned structure with these additions:
- `src/pages/Pickup.tsx`, `src/pages/admin/PickupConfig.tsx`, `src/pages/admin/PickupOrders.tsx`
- `src/pages/admin/EventWaitlist.tsx`
- `src/pages/admin/ForgotPassword.tsx`, `src/pages/admin/ResetPassword.tsx`
- `src/lib/theme/themes.ts` + theme context
- `src/lib/utils/csv.ts`, `src/lib/utils/instagram.ts`, `src/lib/utils/date.ts`
- 9 Supabase migrations under `supabase/migrations/`
- Edge functions: `send-notification`, `send-invite`, `rsvp`

---

## Summary

| Area | Completion |
|---|---|
| Database & RLS | ~95% |
| Edge Functions | 100% (Phase 1) |
| Public pages | 100% |
| Admin pages | 100% (Phase 1) |
| Components | 100% |
| Lib modules | ~90% (Stripe stub remains) |
| Notifications | ~90% (reminder scheduler missing) |
| Payments | Phase 1 done; Phase 2 not started |
| Design system | 100% + bonus second theme |

Phase 1 is functionally complete and shippable. The only Phase 1 gap is the event-reminder scheduler. Phase 2 work (Stripe, realtime, analytics, guest auth, auto-waitlist) has not started.
