-- ============================================================
-- WAITLIST SUPPORT
-- ============================================================

-- 1. Add waitlist columns to rsvps
ALTER TABLE rsvps ADD COLUMN waitlist_position INTEGER;
ALTER TABLE rsvps ADD COLUMN waitlisted_at TIMESTAMPTZ;

-- 2. Update status CHECK to include 'waitlisted'
--    Drop the inline check constraint (auto-named rsvps_status_check)
ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS rsvps_status_check;
-- Also try the common auto-generated name pattern
DO $$
BEGIN
  -- Remove any remaining check on status column
  EXECUTE (
    SELECT 'ALTER TABLE rsvps DROP CONSTRAINT ' || conname
    FROM pg_constraint
    WHERE conrelid = 'rsvps'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
    LIMIT 1
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE rsvps ADD CONSTRAINT rsvps_status_check
  CHECK (status IN ('yes', 'maybe', 'no', 'waitlisted'));

-- 3. Index for efficient waitlist queries
CREATE INDEX idx_rsvps_waitlist ON rsvps (event_id, waitlist_position)
  WHERE status = 'waitlisted';

-- 4. Replace safe_create_rsvp to use 'waitlisted' status
CREATE OR REPLACE FUNCTION safe_create_rsvp(
  p_event_id UUID,
  p_guest_id UUID,
  p_status TEXT
) RETURNS rsvps AS $$
DECLARE
  v_capacity INTEGER;
  v_current_count INTEGER;
  v_next_position INTEGER;
  v_rsvp rsvps;
BEGIN
  -- Get event capacity
  SELECT capacity INTO v_capacity FROM events WHERE id = p_event_id;

  -- If capacity is set and status is 'yes', check availability
  IF v_capacity IS NOT NULL AND p_status = 'yes' THEN
    SELECT COUNT(*) INTO v_current_count
    FROM rsvps
    WHERE event_id = p_event_id AND status = 'yes' AND guest_id != p_guest_id;

    IF v_current_count >= v_capacity THEN
      -- Auto-assign to waitlist instead of 'maybe'
      p_status := 'waitlisted';

      -- Calculate next waitlist position
      SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_position
      FROM rsvps
      WHERE event_id = p_event_id AND status = 'waitlisted';
    END IF;
  END IF;

  -- Upsert the RSVP
  IF p_status = 'waitlisted' THEN
    INSERT INTO rsvps (event_id, guest_id, status, waitlist_position, waitlisted_at)
    VALUES (p_event_id, p_guest_id, p_status, v_next_position, now())
    ON CONFLICT (event_id, guest_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      waitlist_position = EXCLUDED.waitlist_position,
      waitlisted_at = COALESCE(rsvps.waitlisted_at, EXCLUDED.waitlisted_at),
      updated_at = now()
    RETURNING * INTO v_rsvp;
  ELSE
    INSERT INTO rsvps (event_id, guest_id, status, waitlist_position, waitlisted_at)
    VALUES (p_event_id, p_guest_id, p_status, NULL, NULL)
    ON CONFLICT (event_id, guest_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      waitlist_position = NULL,
      waitlisted_at = NULL,
      updated_at = now()
    RETURNING * INTO v_rsvp;
  END IF;

  RETURN v_rsvp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Admin function to promote a guest from waitlist
CREATE OR REPLACE FUNCTION promote_from_waitlist(p_rsvp_id UUID)
RETURNS JSON AS $$
DECLARE
  v_rsvp rsvps;
  v_capacity INTEGER;
  v_current_count INTEGER;
  v_event_id UUID;
BEGIN
  -- Get the RSVP
  SELECT * INTO v_rsvp FROM rsvps WHERE id = p_rsvp_id;

  IF v_rsvp IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'RSVP not found');
  END IF;

  IF v_rsvp.status != 'waitlisted' THEN
    RETURN json_build_object('success', false, 'error', 'Guest is not on the waitlist');
  END IF;

  v_event_id := v_rsvp.event_id;

  -- Check capacity
  SELECT capacity INTO v_capacity FROM events WHERE id = v_event_id;

  IF v_capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current_count
    FROM rsvps
    WHERE event_id = v_event_id AND status = 'yes';

    IF v_current_count >= v_capacity THEN
      RETURN json_build_object('success', false, 'error', 'Event is at capacity');
    END IF;
  END IF;

  -- Promote: set status to 'yes', clear waitlist fields
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
