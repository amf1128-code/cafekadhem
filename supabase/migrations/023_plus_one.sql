-- =============================================================
-- Plus-ones on RSVPs
--
-- A guest reserving a seat can bring one additional person whose name
-- they enter on the form. We model this as a separate RSVP row linked
-- back to the host's RSVP via plus_one_of, so the +1 occupies its own
-- capacity slot and shows up in the public guest list. The plus-one's
-- guest row carries only first_name; email / phone are left null (the
-- host is the reachable party). To make that legal we relax the
-- historical contact_required CHECK on guests; public-form creates
-- still go through upsert_guest, which enforces email-or-phone at the
-- app layer.
-- =============================================================

ALTER TABLE guests DROP CONSTRAINT IF EXISTS contact_required;

ALTER TABLE rsvps
  ADD COLUMN IF NOT EXISTS plus_one_of UUID REFERENCES rsvps(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_rsvps_plus_one_of
  ON rsvps (plus_one_of) WHERE plus_one_of IS NOT NULL;

-- =============================================================
-- add_plus_one(parent_rsvp_id, first_name) — creates the +1's guest
-- row and a child RSVP. Mirrors the parent's status: 'yes' parents try
-- to seat the +1 as 'yes' (waitlisting if capacity is exhausted),
-- 'waitlisted' parents waitlist the +1 too. Refuses other parent
-- statuses ('no'/'maybe') because a +1 only makes sense alongside an
-- actual reservation.
-- =============================================================
CREATE OR REPLACE FUNCTION add_plus_one(
  p_parent_rsvp_id UUID,
  p_first_name TEXT
) RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_parent rsvps;
  v_plus_one_guest_id UUID;
  v_capacity INTEGER;
  v_current_count INTEGER;
  v_status TEXT := 'yes';
  v_position INTEGER;
  v_rsvp rsvps;
  v_first TEXT := NULLIF(trim(p_first_name), '');
BEGIN
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'first_name required';
  END IF;

  SELECT * INTO v_parent FROM rsvps WHERE id = p_parent_rsvp_id;
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'Parent RSVP not found';
  END IF;

  IF v_parent.status NOT IN ('yes', 'waitlisted') THEN
    RAISE EXCEPTION 'Plus-ones are only allowed on going or waitlisted RSVPs';
  END IF;

  -- Stub guest for the +1: only first_name is captured. No contact info,
  -- so any update flow goes through the host instead.
  INSERT INTO guests (first_name, notification_preference)
  VALUES (v_first, 'none')
  RETURNING id INTO v_plus_one_guest_id;

  IF v_parent.status = 'waitlisted' THEN
    v_status := 'waitlisted';
  ELSE
    SELECT capacity INTO v_capacity FROM events WHERE id = v_parent.event_id;
    IF v_capacity IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_count
      FROM rsvps
      WHERE event_id = v_parent.event_id AND status = 'yes';
      IF v_current_count >= v_capacity THEN
        v_status := 'waitlisted';
      END IF;
    END IF;
  END IF;

  IF v_status = 'waitlisted' THEN
    SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_position
    FROM rsvps
    WHERE event_id = v_parent.event_id AND status = 'waitlisted';

    INSERT INTO rsvps (
      event_id, guest_id, status, plus_one_of,
      waitlist_position, waitlisted_at
    )
    VALUES (
      v_parent.event_id, v_plus_one_guest_id, 'waitlisted', p_parent_rsvp_id,
      v_position, now()
    )
    RETURNING * INTO v_rsvp;
  ELSE
    INSERT INTO rsvps (event_id, guest_id, status, plus_one_of)
    VALUES (v_parent.event_id, v_plus_one_guest_id, v_status, p_parent_rsvp_id)
    RETURNING * INTO v_rsvp;
  END IF;

  RETURN v_rsvp;
END;
$$;

REVOKE EXECUTE ON FUNCTION add_plus_one(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_plus_one(UUID, TEXT) TO anon, authenticated;
