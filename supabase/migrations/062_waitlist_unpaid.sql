-- ============================================================
-- 062: Host action — move a single registrant onto the waitlist.
--
-- "Close the door" on one guest at a time from the Tickets page: when a
-- ticketed event is set, the host can move an individual unpaid registrant
-- to the waitlist. After this, that guest's reminder/pay link lands on the
-- waitlist screen (status='waitlisted' has no pay CTA) instead of letting
-- them Venmo in for a seat that's gone — they only get back in if the host
-- promotes them (promote_from_waitlist).
--
-- Typically used on the "needs to pay" set (status='pending_payment', or
-- status='yes' AND payment_status='unpaid'), but the function will waitlist
-- any non-waitlisted row; the UI decides which rows expose the action.
-- payment_status is preserved, so a "paid waitlist" entry is possible.
-- The guest is appended after the current waitlist tail; plus-ones follow
-- their parent automatically via the sync trigger (034).
-- ============================================================

CREATE OR REPLACE FUNCTION waitlist_rsvp(p_rsvp_id UUID)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp          rsvps;
  v_next_position INTEGER;
BEGIN
  SELECT * INTO v_rsvp FROM rsvps WHERE id = p_rsvp_id;
  IF v_rsvp IS NULL THEN
    RAISE EXCEPTION 'RSVP not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || v_rsvp.event_id::text));

  -- Already on the list — nothing to do.
  IF v_rsvp.status = 'waitlisted' THEN
    RETURN v_rsvp;
  END IF;

  SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_position
  FROM   rsvps
  WHERE  event_id = v_rsvp.event_id AND status = 'waitlisted';

  UPDATE rsvps
  SET    status            = 'waitlisted',
         waitlist_position = v_next_position,
         waitlisted_at     = COALESCE(waitlisted_at, now()),
         updated_at        = now()
  WHERE  id = p_rsvp_id
  RETURNING * INTO v_rsvp;

  RETURN v_rsvp;
END;
$$;

REVOKE EXECUTE ON FUNCTION waitlist_rsvp(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION waitlist_rsvp(UUID) TO authenticated;
