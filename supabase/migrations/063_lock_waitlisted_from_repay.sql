-- ============================================================
-- 063: A waitlisted guest can't self-promote back into the pay flow.
--
-- Once a guest is on the waitlist — whether they landed there because the
-- event was full or the host moved them off the unpaid/"said they paid"
-- list — only the host may bring them back (promote_from_waitlist).
--
-- register_pending_payment previously pulled an existing 'waitlisted' row
-- back to 'pending_payment' when the event happened to have room (and
-- moving a guest to the waitlist itself frees a seat, so it often does).
-- That let a waitlisted guest tap "Going" again and re-enter payment. This
-- locks it: an existing 'yes' OR 'waitlisted' row is returned unchanged.
-- Combined with mark_payment_pending (which only promotes pending_payment
-- -> yes), a waitlisted guest can no longer pay their way in.
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
  v_rsvp          rsvps;
  v_existing      rsvps;
  v_capacity      INTEGER;
  v_current_count INTEGER;
  v_next_position INTEGER;
  v_full          BOOLEAN := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || p_event_id::text));

  -- Already counted ('yes') or held on the waitlist? Leave it untouched —
  -- promotion off the waitlist is host-only.
  SELECT * INTO v_existing
  FROM   rsvps
  WHERE  event_id = p_event_id
    AND  guest_id = p_guest_id
    AND  plus_one_of IS NULL;

  IF v_existing.status IN ('yes', 'waitlisted') THEN
    RETURN v_existing;
  END IF;

  -- Capacity gate: if the room is full, switch this registration over to
  -- the waitlist rather than sending them into the pay flow.
  SELECT capacity INTO v_capacity FROM events WHERE id = p_event_id;
  IF v_capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current_count
    FROM   rsvps
    WHERE  event_id = p_event_id
      AND  status   = 'yes'
      AND  guest_id != p_guest_id;

    IF v_current_count >= v_capacity THEN
      v_full := true;
      SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_position
      FROM   rsvps
      WHERE  event_id = p_event_id AND status = 'waitlisted';
    END IF;
  END IF;

  IF v_full THEN
    INSERT INTO rsvps (event_id, guest_id, status, payment_status, waitlist_position, waitlisted_at)
    VALUES (p_event_id, p_guest_id, 'waitlisted', 'unpaid', v_next_position, now())
    ON CONFLICT (event_id, guest_id) DO UPDATE
      SET status            = CASE WHEN rsvps.status IN ('yes', 'waitlisted') THEN rsvps.status ELSE 'waitlisted' END,
          waitlist_position = COALESCE(rsvps.waitlist_position, EXCLUDED.waitlist_position),
          waitlisted_at     = COALESCE(rsvps.waitlisted_at, EXCLUDED.waitlisted_at),
          updated_at        = now()
    RETURNING * INTO v_rsvp;
  ELSE
    INSERT INTO rsvps (event_id, guest_id, status, payment_status)
    VALUES (p_event_id, p_guest_id, 'pending_payment', 'unpaid')
    ON CONFLICT (event_id, guest_id) DO UPDATE
      SET status     = CASE WHEN rsvps.status IN ('yes', 'waitlisted') THEN rsvps.status ELSE 'pending_payment' END,
          updated_at = now()
    RETURNING * INTO v_rsvp;
  END IF;

  RETURN v_rsvp;
END;
$$;

GRANT EXECUTE ON FUNCTION register_pending_payment(UUID, UUID) TO anon, authenticated;
