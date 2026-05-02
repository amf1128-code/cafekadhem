-- ============================================================
-- Promote from waitlist: auto-bump capacity by 1 when full
-- ============================================================
-- Old behavior refused to promote if event was at capacity, forcing the
-- admin to edit the event to raise capacity first. New behavior bumps
-- capacity by exactly 1 per promotion so single-click promote always
-- works. Promotion is still strictly manual — auto-promote on cancel is
-- intentionally unimplemented; the admin keeps control of the guest list.
-- ============================================================

CREATE OR REPLACE FUNCTION promote_from_waitlist(p_rsvp_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp rsvps;
  v_capacity INTEGER;
  v_current_count INTEGER;
  v_event_id UUID;
BEGIN
  SELECT * INTO v_rsvp FROM rsvps WHERE id = p_rsvp_id;
  IF v_rsvp IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'RSVP not found');
  END IF;
  IF v_rsvp.status <> 'waitlisted' THEN
    RETURN json_build_object('success', false, 'error', 'Guest is not on the waitlist');
  END IF;

  v_event_id := v_rsvp.event_id;
  SELECT capacity INTO v_capacity FROM events WHERE id = v_event_id;

  IF v_capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current_count
    FROM rsvps
    WHERE event_id = v_event_id AND status = 'yes';

    -- If the event is at or over capacity, bump capacity by exactly 1 so
    -- the promotion succeeds. Admins retain full control via the manual
    -- click; this just removes the round-trip to the event editor.
    IF v_current_count >= v_capacity THEN
      UPDATE events SET capacity = capacity + 1 WHERE id = v_event_id;
    END IF;
  END IF;

  UPDATE rsvps
  SET status = 'yes',
      waitlist_position = NULL,
      waitlisted_at = NULL,
      updated_at = now()
  WHERE id = p_rsvp_id;

  -- Reorder remaining waitlist positions
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position) AS new_pos
    FROM rsvps
    WHERE event_id = v_event_id AND status = 'waitlisted'
  )
  UPDATE rsvps
  SET waitlist_position = ranked.new_pos
  FROM ranked
  WHERE rsvps.id = ranked.id;

  RETURN json_build_object('success', true, 'guest_id', v_rsvp.guest_id);
END;
$$;
