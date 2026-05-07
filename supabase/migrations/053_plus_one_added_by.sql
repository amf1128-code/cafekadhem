-- ============================================================
-- 053: Track who added a +1 guest.
--
-- Plus-ones currently land in the guests directory as bare
-- first-name stubs with no contact info, and there's no way to
-- tell them apart from real (just-incomplete) guests or to know
-- which host brought them. This adds an `added_as_plus_one_by`
-- self-FK on guests so the directory can render a "+1 of Alice"
-- chip and the operator can audit who's bringing whom.
--
-- ON DELETE SET NULL: if the host is hard-deleted (nuke_guest),
-- the +1 row is already cascaded out via rsvps.guest_id, so the
-- SET NULL only matters in edge cases (e.g. host nuked while a
-- +1 row was orphaned) — we'd rather keep the +1 visible than
-- block the delete.
-- ============================================================

ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS added_as_plus_one_by UUID
    REFERENCES guests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guests_added_as_plus_one_by
  ON guests (added_as_plus_one_by)
  WHERE added_as_plus_one_by IS NOT NULL;

COMMENT ON COLUMN guests.added_as_plus_one_by IS
  'When set, this guest was created as a +1 by the referenced host guest. Stub guests (first-name only, no email/phone) get this populated by add_plus_one().';

-- ============================================================
-- Backfill: any existing guest who only exists as a +1 RSVP
-- gets stamped with their host's guest_id. The host is the
-- guest_id of the parent RSVP (rsvps.id = child.plus_one_of).
-- ============================================================
UPDATE guests g
   SET added_as_plus_one_by = parent.guest_id
  FROM rsvps child
  JOIN rsvps parent ON parent.id = child.plus_one_of
 WHERE child.guest_id = g.id
   AND child.plus_one_of IS NOT NULL
   AND g.added_as_plus_one_by IS NULL;

-- ============================================================
-- Update add_plus_one to stamp the host on the new guest row.
-- The host is the guest_id of the parent RSVP — we already look
-- up the parent, so this is a one-line change. Signature is
-- unchanged so existing callers keep working.
-- ============================================================
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
  -- so any update flow goes through the host instead. added_as_plus_one_by
  -- points back at the host so the guest directory can render the link.
  INSERT INTO guests (first_name, notification_preference, added_as_plus_one_by)
  VALUES (v_first, 'none', v_parent.guest_id)
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
