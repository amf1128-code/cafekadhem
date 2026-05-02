-- ============================================================
-- TICKETS
-- Adds optional paid ticketing on top of RSVPs.
--   1. Per-event toggle + price
--   2. RSVP-level payment status, ticket token, paid/check-in timestamps
--   3. RPCs for the payment queue + door scanner flows
--   4. SECURITY DEFINER `get_ticket(token)` for the public /ticket/:token page
-- ============================================================

-- 1. Event-level ticketing config
ALTER TABLE events ADD COLUMN ticketing_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN ticket_price DECIMAL(10,2);

-- 2. RSVP-level ticket fields
ALTER TABLE rsvps ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'refunded'));
ALTER TABLE rsvps ADD COLUMN ticket_token TEXT UNIQUE;
ALTER TABLE rsvps ADD COLUMN paid_at TIMESTAMPTZ;
ALTER TABLE rsvps ADD COLUMN checked_in_at TIMESTAMPTZ;

CREATE INDEX idx_rsvps_payment_status ON rsvps (event_id, payment_status);
CREATE INDEX idx_rsvps_ticket_token ON rsvps (ticket_token) WHERE ticket_token IS NOT NULL;

-- ============================================================
-- mark_payment_pending: guest tells us they sent Venmo. Anyone with the
-- rsvp id may call this; admin still has to verify before issuing a ticket.
-- ============================================================
CREATE OR REPLACE FUNCTION mark_payment_pending(p_rsvp_id UUID)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp rsvps;
BEGIN
  UPDATE rsvps
  SET payment_status = 'pending',
      updated_at = now()
  WHERE id = p_rsvp_id
    AND payment_status IN ('unpaid', 'pending')
  RETURNING * INTO v_rsvp;

  IF v_rsvp IS NULL THEN
    RAISE EXCEPTION 'RSVP not found or already finalized';
  END IF;

  RETURN v_rsvp;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_payment_pending(UUID) TO anon, authenticated;

-- ============================================================
-- mark_rsvp_paid: admin verifies the Venmo arrived and issues a ticket.
-- Idempotent — re-running keeps the original token + paid_at.
-- ============================================================
CREATE OR REPLACE FUNCTION mark_rsvp_paid(p_rsvp_id UUID)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp rsvps;
  v_token TEXT;
BEGIN
  SELECT * INTO v_rsvp FROM rsvps WHERE id = p_rsvp_id FOR UPDATE;
  IF v_rsvp IS NULL THEN
    RAISE EXCEPTION 'RSVP not found';
  END IF;

  v_token := COALESCE(v_rsvp.ticket_token, encode(gen_random_bytes(16), 'hex'));

  UPDATE rsvps
  SET payment_status = 'paid',
      paid_at = COALESCE(rsvps.paid_at, now()),
      ticket_token = v_token,
      updated_at = now()
  WHERE id = p_rsvp_id
  RETURNING * INTO v_rsvp;

  RETURN v_rsvp;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_rsvp_paid(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_rsvp_paid(UUID) TO authenticated;

-- ============================================================
-- mark_rsvp_unpaid: undo button on the queue.
-- ============================================================
CREATE OR REPLACE FUNCTION mark_rsvp_unpaid(p_rsvp_id UUID)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp rsvps;
BEGIN
  UPDATE rsvps
  SET payment_status = 'unpaid',
      paid_at = NULL,
      updated_at = now()
  WHERE id = p_rsvp_id
  RETURNING * INTO v_rsvp;

  IF v_rsvp IS NULL THEN
    RAISE EXCEPTION 'RSVP not found';
  END IF;

  RETURN v_rsvp;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_rsvp_unpaid(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_rsvp_unpaid(UUID) TO authenticated;

-- ============================================================
-- get_ticket: public read-by-token for the /ticket/:token page.
-- Returns NULL if the token doesn't match a paid ticket.
-- ============================================================
CREATE OR REPLACE FUNCTION get_ticket(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_rsvp rsvps;
  v_guest guests;
  v_event events;
BEGIN
  SELECT * INTO v_rsvp
  FROM rsvps
  WHERE ticket_token = p_token
    AND payment_status = 'paid';

  IF v_rsvp IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_guest FROM guests WHERE id = v_rsvp.guest_id;
  SELECT * INTO v_event FROM events WHERE id = v_rsvp.event_id;

  RETURN json_build_object(
    'rsvp_id',           v_rsvp.id,
    'token',             v_rsvp.ticket_token,
    'checked_in_at',     v_rsvp.checked_in_at,
    'paid_at',           v_rsvp.paid_at,
    'guest_first_name',  v_guest.first_name,
    'guest_last_name',   v_guest.last_name,
    'event_id',          v_event.id,
    'event_title',       v_event.title,
    'event_date',        v_event.date,
    'event_start_time',  v_event.start_time,
    'event_end_time',    v_event.end_time,
    'event_location',    v_event.location,
    'event_location_name', v_event.location_name,
    'gathering_number',  v_event.gathering_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_ticket(TEXT) TO anon, authenticated;

-- ============================================================
-- check_in_ticket: door scanner. Authenticated-only. Idempotent —
-- re-scanning a checked-in ticket reports already_checked_in=true.
-- ============================================================
CREATE OR REPLACE FUNCTION check_in_ticket(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp rsvps;
  v_guest guests;
  v_event events;
  v_was_already BOOLEAN;
  v_first_check_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_rsvp FROM rsvps WHERE ticket_token = p_token FOR UPDATE;
  IF v_rsvp IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invalid ticket');
  END IF;
  IF v_rsvp.payment_status <> 'paid' THEN
    RETURN json_build_object('success', false, 'error', 'Ticket is not paid');
  END IF;

  v_was_already := v_rsvp.checked_in_at IS NOT NULL;
  v_first_check_at := v_rsvp.checked_in_at;

  IF NOT v_was_already THEN
    UPDATE rsvps
    SET checked_in_at = now(), updated_at = now()
    WHERE id = v_rsvp.id
    RETURNING checked_in_at INTO v_first_check_at;
  END IF;

  SELECT * INTO v_guest FROM guests WHERE id = v_rsvp.guest_id;
  SELECT * INTO v_event FROM events WHERE id = v_rsvp.event_id;

  RETURN json_build_object(
    'success',             true,
    'already_checked_in',  v_was_already,
    'rsvp_id',             v_rsvp.id,
    'guest_first_name',    v_guest.first_name,
    'guest_last_name',     v_guest.last_name,
    'event_id',            v_event.id,
    'event_title',         v_event.title,
    'checked_in_at',       v_first_check_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION check_in_ticket(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION check_in_ticket(TEXT) TO authenticated;

-- ============================================================
-- undo_check_in: admin can revert an accidental scan.
-- ============================================================
CREATE OR REPLACE FUNCTION undo_check_in(p_rsvp_id UUID)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp rsvps;
BEGIN
  UPDATE rsvps
  SET checked_in_at = NULL, updated_at = now()
  WHERE id = p_rsvp_id
  RETURNING * INTO v_rsvp;

  IF v_rsvp IS NULL THEN
    RAISE EXCEPTION 'RSVP not found';
  END IF;

  RETURN v_rsvp;
END;
$$;

REVOKE EXECUTE ON FUNCTION undo_check_in(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION undo_check_in(UUID) TO authenticated;
