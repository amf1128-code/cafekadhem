-- ============================================================
-- Lockdown: drop the broad anon SELECT/UPDATE/INSERT policies that the
-- new SECURITY DEFINER RPCs replace. Apply this AFTER the client
-- migration (commit deploying RSVPForm/Order/Pickup/PickupTicket against
-- get_my_guest / upsert_guest / get_pickup_order) is live and verified.
--
-- Public still has the targeted accesses it actually needs:
--   - admin_settings   : read (venmo_handle, theme, site_url)
--   - menus            : read
--   - public_menu_items: read (column-stripped view, no unit_cost)
--   - public_guest_profiles : read (column-stripped view, only id/first_name/instagram)
--   - events           : read where is_published = true
--   - rsvps            : read (counts and event guest list — fine, no PII)
--   - invites          : read by token, insert (still direct; future cleanup)
--   - pickup_config    : read
--   - pickup_slots     : read
--   - magic_links      : zero anon access (already; service role only)
--
-- Everything else now goes through SECURITY DEFINER RPCs.
-- ============================================================

-- ============================================================
-- guests: previously fully readable + updatable + insertable by anon.
-- Now: zero direct anon access; all reads go through public_guest_profiles
-- (a column-stripped view) or get_my_guest, all writes through upsert_guest.
-- ============================================================
DROP POLICY IF EXISTS "Public can read guests" ON guests;
DROP POLICY IF EXISTS "Public can update own guest" ON guests;
DROP POLICY IF EXISTS "Public can insert guests" ON guests;

-- The public_guest_profiles view used to rely on the dropped "Public can
-- read guests" policy to read the underlying table. Pin it to definer-
-- mode so it keeps working with anon callers regardless of RLS, and grant
-- the SELECT explicitly so we are not depending on default schema grants.
ALTER VIEW public_guest_profiles SET (security_invoker = false);
GRANT SELECT ON public_guest_profiles TO anon, authenticated;

-- ============================================================
-- rsvps: keep public READ (anon callers need RSVP counts on the home
-- page and the event guest list). Drop public UPDATE (verified unused
-- in client code; updates flow through safe_create_rsvp / mark_payment_*
-- / promote_from_waitlist) and public INSERT (replaced by safe_create_rsvp).
-- ============================================================
DROP POLICY IF EXISTS "Public can update rsvps" ON rsvps;
DROP POLICY IF EXISTS "Public can insert rsvps" ON rsvps;

-- ============================================================
-- orders / order_items: anon never reads these tables (the client only
-- calls safe_create_order, which returns the row inline). Drop both the
-- read and insert policies; safe_create_order is SECURITY DEFINER and
-- inserts on its own authority.
-- ============================================================
DROP POLICY IF EXISTS "Public can read own orders" ON orders;
DROP POLICY IF EXISTS "Public can insert orders" ON orders;
DROP POLICY IF EXISTS "Public can read order items" ON order_items;
DROP POLICY IF EXISTS "Public can insert order items" ON order_items;

-- ============================================================
-- pickup_orders / pickup_order_items: PickupTicket now reads through
-- get_pickup_order(token), and Pickup writes through safe_create_pickup_order.
-- Drop the broad read and insert policies.
-- ============================================================
DROP POLICY IF EXISTS "Public can read own pickup orders" ON pickup_orders;
DROP POLICY IF EXISTS "Public can create pickup orders" ON pickup_orders;
DROP POLICY IF EXISTS "Public can read pickup order items" ON pickup_order_items;
DROP POLICY IF EXISTS "Public can create pickup order items" ON pickup_order_items;
