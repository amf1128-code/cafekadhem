-- ============================================================
-- 064: Promote-to-payment for the ticketed flow + reserved seats.
--
-- Today promote_from_waitlist sets a guest straight to 'yes' (counted,
-- no payment) and bumps capacity by 1 when full. For a *ticketed* event
-- the host wants the opposite: promote the guest off the waitlist but make
-- them secure the seat by paying — i.e. land them in 'pending_payment'
-- (which is exactly the state that unlocks the /pay page; a 'waitlisted'
-- row shows the waitlist screen with no pay CTA, per migration 063).
--
-- The catch: 'pending_payment' isn't counted, so a promoted guest's later
-- payment would hit the capacity gate and could get re-waitlisted (and
-- bumping the public capacity would re-open sales to strangers, showing
-- "1 left"). To avoid both, we RESERVE the seat: promote_to_payment stamps
-- rsvps.promoted_at, and mark_payment_pending / mark_rsvp_paid let a
-- promoted row through the capacity check (the host already decided to
-- admit them). The reservation clears once they're seated ('yes').
-- ============================================================

ALTER TABLE rsvps
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;

COMMENT ON COLUMN rsvps.promoted_at IS
  'Set when a host promotes a waitlisted guest into pending_payment on a ticketed event. Marks a reserved seat: their payment bypasses the capacity gate. Cleared when they become ''yes''.';

-- ------------------------------------------------------------
-- promote_to_payment: ticketed-flow promotion. A guest who already paid
-- or self-attested is simply seated ('yes'); an unpaid guest is moved to
-- 'pending_payment' with a reserved seat (promoted_at) so the pay page
-- opens for them and their payment is guaranteed to land. Remaining
-- waitlist positions are re-ranked. Returns the updated row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION promote_to_payment(p_rsvp_id UUID)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp rsvps;
BEGIN
  SELECT * INTO v_rsvp FROM rsvps WHERE id = p_rsvp_id;
  IF v_rsvp IS NULL THEN
    RAISE EXCEPTION 'RSVP not found';
  END IF;
  IF v_rsvp.status <> 'waitlisted' THEN
    RAISE EXCEPTION 'Guest is not on the waitlist';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || v_rsvp.event_id::text));

  IF v_rsvp.payment_status IN ('paid', 'pending') THEN
    -- Already paid / said they paid: just seat them. No reservation needed.
    UPDATE rsvps
    SET status = 'yes', waitlist_position = NULL, waitlisted_at = NULL,
        promoted_at = NULL, updated_at = now()
    WHERE id = p_rsvp_id
    RETURNING * INTO v_rsvp;
  ELSE
    -- Unpaid: move to pending_payment with a reserved seat so the pay page
    -- opens and their payment can't be bounced by the capacity gate.
    UPDATE rsvps
    SET status = 'pending_payment', waitlist_position = NULL, waitlisted_at = NULL,
        promoted_at = now(), updated_at = now()
    WHERE id = p_rsvp_id
    RETURNING * INTO v_rsvp;
  END IF;

  -- Re-rank the rest of the waitlist (gaps tolerated, but keep it tidy).
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position) AS new_pos
    FROM   rsvps
    WHERE  event_id = v_rsvp.event_id AND status = 'waitlisted'
  )
  UPDATE rsvps r
  SET    waitlist_position = ranked.new_pos
  FROM   ranked
  WHERE  r.id = ranked.id;

  RETURN v_rsvp;
END;
$$;

REVOKE EXECUTE ON FUNCTION promote_to_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION promote_to_payment(UUID) TO authenticated;

-- ------------------------------------------------------------
-- mark_payment_pending (replaces 061): a reserved (promoted_at) row skips
-- the capacity gate — the host already admitted them — and the reservation
-- clears once they're seated.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_payment_pending(p_rsvp_id UUID)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp          rsvps;
  v_capacity      INTEGER;
  v_current_count INTEGER;
  v_next_position INTEGER;
  v_target_status TEXT;
BEGIN
  SELECT * INTO v_rsvp FROM rsvps WHERE id = p_rsvp_id;
  IF v_rsvp IS NULL OR v_rsvp.payment_status NOT IN ('unpaid', 'pending') THEN
    RAISE EXCEPTION 'RSVP not found or already finalized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || v_rsvp.event_id::text));

  v_target_status := v_rsvp.status;

  IF v_rsvp.status = 'pending_payment' THEN
    IF v_rsvp.promoted_at IS NOT NULL THEN
      -- Reserved by a host promotion: seat them regardless of capacity.
      v_target_status := 'yes';
    ELSE
      SELECT capacity INTO v_capacity FROM events WHERE id = v_rsvp.event_id;
      IF v_capacity IS NULL THEN
        v_target_status := 'yes';
      ELSE
        SELECT COUNT(*) INTO v_current_count
        FROM   rsvps
        WHERE  event_id = v_rsvp.event_id AND status = 'yes' AND id != p_rsvp_id;

        IF v_current_count >= v_capacity THEN
          v_target_status := 'waitlisted';
          SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_position
          FROM   rsvps
          WHERE  event_id = v_rsvp.event_id AND status = 'waitlisted';
        ELSE
          v_target_status := 'yes';
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE rsvps
  SET payment_status    = 'pending',
      status            = v_target_status,
      waitlist_position = CASE WHEN v_target_status = 'waitlisted'
                               THEN COALESCE(v_rsvp.waitlist_position, v_next_position)
                               ELSE NULL END,
      waitlisted_at     = CASE WHEN v_target_status = 'waitlisted'
                               THEN COALESCE(v_rsvp.waitlisted_at, now())
                               ELSE NULL END,
      promoted_at       = CASE WHEN v_target_status = 'yes' THEN NULL ELSE promoted_at END,
      updated_at        = now()
  WHERE id = p_rsvp_id
  RETURNING * INTO v_rsvp;

  RETURN v_rsvp;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_payment_pending(UUID) TO anon, authenticated;

-- ------------------------------------------------------------
-- mark_rsvp_paid (replaces 061): same reserved-seat bypass.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_rsvp_paid(p_rsvp_id UUID)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp          rsvps;
  v_token         TEXT;
  v_capacity      INTEGER;
  v_current_count INTEGER;
  v_next_position INTEGER;
  v_target_status TEXT;
BEGIN
  SELECT * INTO v_rsvp FROM rsvps WHERE id = p_rsvp_id FOR UPDATE;
  IF v_rsvp IS NULL THEN
    RAISE EXCEPTION 'RSVP not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || v_rsvp.event_id::text));

  v_token         := COALESCE(v_rsvp.ticket_token, encode(gen_random_bytes(16), 'hex'));
  v_target_status := v_rsvp.status;

  IF v_rsvp.status = 'pending_payment' THEN
    IF v_rsvp.promoted_at IS NOT NULL THEN
      v_target_status := 'yes';
    ELSE
      SELECT capacity INTO v_capacity FROM events WHERE id = v_rsvp.event_id;
      IF v_capacity IS NULL THEN
        v_target_status := 'yes';
      ELSE
        SELECT COUNT(*) INTO v_current_count
        FROM   rsvps
        WHERE  event_id = v_rsvp.event_id AND status = 'yes' AND id != p_rsvp_id;

        IF v_current_count >= v_capacity THEN
          v_target_status := 'waitlisted';
          SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_position
          FROM   rsvps
          WHERE  event_id = v_rsvp.event_id AND status = 'waitlisted';
        ELSE
          v_target_status := 'yes';
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE rsvps
  SET payment_status    = 'paid',
      status            = v_target_status,
      waitlist_position = CASE WHEN v_target_status = 'waitlisted'
                               THEN COALESCE(v_rsvp.waitlist_position, v_next_position)
                               ELSE NULL END,
      waitlisted_at     = CASE WHEN v_target_status = 'waitlisted'
                               THEN COALESCE(v_rsvp.waitlisted_at, now())
                               ELSE NULL END,
      promoted_at       = CASE WHEN v_target_status = 'yes' THEN NULL ELSE promoted_at END,
      paid_at           = COALESCE(rsvps.paid_at, now()),
      ticket_token      = v_token,
      updated_at        = now()
  WHERE id = p_rsvp_id
  RETURNING * INTO v_rsvp;

  RETURN v_rsvp;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_rsvp_paid(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_rsvp_paid(UUID) TO authenticated;
