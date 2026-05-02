-- ============================================================
-- MAGIC LINKS for "find my tickets"
--   1. magic_links table — short-lived hashed tokens scoped to a guest
--   2. find_guest_by_contact(email/phone) — SECURITY DEFINER lookup that
--      returns just the guest id + masked contact, never the full PII row
--   3. redeem_magic_link(token) — verifies the hash, marks it used,
--      and returns the guest id so the client can set its persistent cookie
--   4. get_guest_history(guest_id) — RSVPs + tickets + pickup orders
-- ============================================================

CREATE TABLE magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID REFERENCES guests(id) ON DELETE CASCADE NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_magic_links_guest_id ON magic_links (guest_id);
CREATE INDEX idx_magic_links_expires_at ON magic_links (expires_at);

ALTER TABLE magic_links ENABLE ROW LEVEL SECURITY;
-- No anon access; everything goes through SECURITY DEFINER RPCs and the
-- service-role edge function.
CREATE POLICY "Admin can manage magic links"
  ON magic_links FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- find_guest_by_contact: takes a normalized email or phone, returns the
-- matching guest id (or NULL). Does NOT return the unmatched contact field
-- back, so this can't be used as a phone-number scraper. Used by the
-- lookup-tickets edge function before it issues a magic link.
-- ============================================================
CREATE OR REPLACE FUNCTION find_guest_by_contact(
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_guest_id UUID;
BEGIN
  IF p_email IS NOT NULL AND length(trim(p_email)) > 0 THEN
    SELECT id INTO v_guest_id
    FROM guests
    WHERE lower(email) = lower(trim(p_email))
    ORDER BY created_at DESC
    LIMIT 1;
  ELSIF p_phone IS NOT NULL AND length(trim(p_phone)) > 0 THEN
    SELECT id INTO v_guest_id
    FROM guests
    WHERE phone = trim(p_phone)
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  RETURN v_guest_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION find_guest_by_contact(TEXT, TEXT) FROM PUBLIC, anon;
-- Only the service-role edge function calls this; do not grant to anon.

-- ============================================================
-- redeem_magic_link: takes a raw token from the URL, hashes it, finds the
-- matching unused, unexpired row, marks it used, and returns the guest id.
-- Returns NULL on any failure (expired, used, not found).
-- ============================================================
CREATE OR REPLACE FUNCTION redeem_magic_link(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hash TEXT;
  v_link magic_links;
BEGIN
  IF p_token IS NULL OR length(p_token) = 0 THEN
    RETURN NULL;
  END IF;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_link
  FROM magic_links
  WHERE token_hash = v_hash
    AND used_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF v_link IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE magic_links SET used_at = now() WHERE id = v_link.id;

  RETURN v_link.guest_id;
END;
$$;

GRANT EXECUTE ON FUNCTION redeem_magic_link(TEXT) TO anon, authenticated;

-- ============================================================
-- get_guest_history: returns all the guest's RSVPs (with event + ticket
-- info) and pickup orders. Used by the /my-tickets page. Scoped to a
-- single guest_id passed by the client — that id comes from either the
-- redeemed magic link or the persistent localStorage token.
-- ============================================================
CREATE OR REPLACE FUNCTION get_guest_history(p_guest_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_guest guests;
  v_rsvps JSON;
  v_pickups JSON;
BEGIN
  SELECT * INTO v_guest FROM guests WHERE id = p_guest_id;
  IF v_guest IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.event_date DESC), '[]'::json)
  INTO v_rsvps
  FROM (
    SELECT
      rsvps.id            AS rsvp_id,
      rsvps.status,
      rsvps.payment_status,
      rsvps.ticket_token,
      rsvps.checked_in_at,
      rsvps.created_at    AS rsvp_created_at,
      events.id           AS event_id,
      events.title        AS event_title,
      events.date         AS event_date,
      events.start_time   AS event_start_time,
      events.end_time     AS event_end_time,
      events.location     AS event_location,
      events.location_name AS event_location_name,
      events.flyer_url    AS event_flyer_url,
      events.ticketing_enabled,
      events.ticket_price,
      events.is_published
    FROM rsvps
    JOIN events ON events.id = rsvps.event_id
    WHERE rsvps.guest_id = p_guest_id
  ) r;

  SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.pickup_date DESC), '[]'::json)
  INTO v_pickups
  FROM (
    SELECT
      pickup_orders.id,
      pickup_orders.pickup_date,
      pickup_orders.pickup_time,
      pickup_orders.status,
      pickup_orders.total,
      pickup_orders.created_at
    FROM pickup_orders
    WHERE guest_id = p_guest_id
  ) p;

  RETURN json_build_object(
    'guest_id',    v_guest.id,
    'first_name',  v_guest.first_name,
    'last_name',   v_guest.last_name,
    'rsvps',       v_rsvps,
    'pickups',     v_pickups
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_guest_history(UUID) TO anon, authenticated;
