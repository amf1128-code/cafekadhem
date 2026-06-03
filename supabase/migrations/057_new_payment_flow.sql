-- ============================================================
-- 057: New payment-gated RSVP flow (behind a per-event toggle).
--
-- Introduces a third "trying to attend" state so an unpaid registrant
-- is recorded but NOT counted as going:
--
--   State 1  status='pending_payment', payment='unpaid'   -> NOT counted
--   State 2  status='yes',             payment='pending'  -> counted (trust)
--   State 3  status='yes',             payment='paid'     -> counted
--
-- "Counted / going" stays exactly `status = 'yes'`, so every existing
-- capacity / roster / availability check keeps working unchanged — the
-- new flow simply withholds 'yes' until there's a payment signal.
--
-- Rollout is gated by events.use_new_rsvp_flow (default false), so
-- existing events and existing rows are untouched. Existing yes+unpaid
-- rows are grandfathered (left as counted); only NEW registrations on
-- flagged events go through the pending_payment state.
-- ============================================================

-- 1. Per-event toggle. Default false = current flow everywhere.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS use_new_rsvp_flow BOOLEAN NOT NULL DEFAULT false;

-- 2. Allow the new status value.
ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS rsvps_status_check;
ALTER TABLE rsvps ADD CONSTRAINT rsvps_status_check
  CHECK (status IN ('yes', 'maybe', 'no', 'waitlisted', 'pending_payment'));

-- ============================================================
-- register_pending_payment: the new flow's first write. Records the
-- guest's intent to attend WITHOUT counting them (status 'pending_payment').
-- Idempotent; never downgrades someone who is already going ('yes').
-- Capacity is intentionally NOT checked here — a registrant isn't taking
-- a seat until they pay.
-- ============================================================
CREATE OR REPLACE FUNCTION register_pending_payment(
  p_event_id UUID,
  p_guest_id UUID
)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp rsvps;
BEGIN
  INSERT INTO rsvps (event_id, guest_id, status, payment_status)
  VALUES (p_event_id, p_guest_id, 'pending_payment', 'unpaid')
  ON CONFLICT (event_id, guest_id) DO UPDATE
    SET status = CASE
                   WHEN rsvps.status = 'yes' THEN 'yes'  -- already going: leave it
                   ELSE 'pending_payment'
                 END,
        updated_at = now()
  RETURNING * INTO v_rsvp;

  RETURN v_rsvp;
END;
$$;

GRANT EXECUTE ON FUNCTION register_pending_payment(UUID, UUID) TO anon, authenticated;

-- ============================================================
-- mark_payment_pending (REPLACES migration 010): guest self-attests
-- "I've paid". On the new flow this also PROMOTES the registrant to a
-- counted attendee (pending_payment -> yes). No-op on the status for
-- old-flow rows (already 'yes').
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
      status = CASE WHEN status = 'pending_payment' THEN 'yes' ELSE status END,
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
-- mark_rsvp_paid (REPLACES migration 010): host confirms payment and
-- issues a ticket. Also promotes pending_payment -> yes, so confirming a
-- never-self-attested registrant pulls them into the count.
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
      status = CASE WHEN status = 'pending_payment' THEN 'yes' ELSE status END,
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
-- mark_rsvp_unpaid (REPLACES migration 010): host reverts a payment.
-- On the new flow this drops the guest back to the uncounted
-- pending_payment state (so they stop counting). On old-flow events the
-- status is left as-is (current behaviour: they stay 'yes' but unpaid).
-- ============================================================
CREATE OR REPLACE FUNCTION mark_rsvp_unpaid(p_rsvp_id UUID)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp rsvps;
  v_new_flow BOOLEAN;
BEGIN
  SELECT COALESCE(e.use_new_rsvp_flow, false) INTO v_new_flow
  FROM rsvps r
  JOIN events e ON e.id = r.event_id
  WHERE r.id = p_rsvp_id;

  UPDATE rsvps
  SET payment_status = 'unpaid',
      paid_at = NULL,
      status = CASE
                 WHEN v_new_flow AND status = 'yes' THEN 'pending_payment'
                 ELSE status
               END,
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
