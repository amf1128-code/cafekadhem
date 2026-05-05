-- ============================================================
-- Fix duplicate RSVPs
--
-- Root cause: safe_create_rsvp relied purely on (event_id, guest_id)
-- uniqueness. If the client-side upsert_guest call produced a fresh
-- guest record instead of finding the existing one (e.g. because the
-- localStorage token was stale after an unmount/remount cycle), the
-- subsequent safe_create_rsvp INSERT would see no conflict and insert
-- a second "going" row for the same person.
--
-- Fix: add a contact-based dedup step at the top of safe_create_rsvp.
-- Before doing the capacity check and INSERT, look for a non-plus-one
-- RSVP in this event from a guest whose email or phone matches the
-- incoming guest. If one is found, redirect p_guest_id to that
-- existing guest so the subsequent ON CONFLICT path updates the
-- correct row rather than inserting a duplicate.
-- ============================================================

CREATE OR REPLACE FUNCTION safe_create_rsvp(
  p_event_id UUID,
  p_guest_id UUID,
  p_status TEXT
) RETURNS rsvps AS $$
DECLARE
  v_capacity        INTEGER;
  v_current_count   INTEGER;
  v_next_position   INTEGER;
  v_rsvp            rsvps;
  v_canonical_guest UUID;
BEGIN
  -- Dedup: if another non-plus-one RSVP already exists for this event
  -- from a guest whose email/phone matches the incoming guest, use that
  -- guest's id. This collapses accidental duplicate-guest records back
  -- onto the original RSVP row via the ON CONFLICT path below.
  SELECT r.guest_id INTO v_canonical_guest
  FROM   rsvps r
  JOIN   guests g_new      ON g_new.id      = p_guest_id
  JOIN   guests g_existing ON g_existing.id = r.guest_id
  WHERE  r.event_id       = p_event_id
    AND  r.plus_one_of    IS NULL
    AND  r.guest_id       != p_guest_id
    AND  (
           (g_new.email IS NOT NULL
            AND lower(g_existing.email) = lower(g_new.email))
        OR (g_new.phone IS NOT NULL
            AND g_existing.phone = g_new.phone)
         )
  LIMIT 1;

  IF v_canonical_guest IS NOT NULL THEN
    p_guest_id := v_canonical_guest;
  END IF;

  -- Capacity check (only for 'yes' requests)
  SELECT capacity INTO v_capacity FROM events WHERE id = p_event_id;

  IF v_capacity IS NOT NULL AND p_status = 'yes' THEN
    SELECT COUNT(*) INTO v_current_count
    FROM   rsvps
    WHERE  event_id = p_event_id
      AND  status   = 'yes'
      AND  guest_id != p_guest_id;

    IF v_current_count >= v_capacity THEN
      p_status := 'waitlisted';

      SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_position
      FROM   rsvps
      WHERE  event_id = p_event_id AND status = 'waitlisted';
    END IF;
  END IF;

  -- Upsert
  IF p_status = 'waitlisted' THEN
    INSERT INTO rsvps (event_id, guest_id, status, waitlist_position, waitlisted_at)
    VALUES (p_event_id, p_guest_id, p_status, v_next_position, now())
    ON CONFLICT (event_id, guest_id)
    DO UPDATE SET
      status            = EXCLUDED.status,
      waitlist_position = EXCLUDED.waitlist_position,
      waitlisted_at     = COALESCE(rsvps.waitlisted_at, EXCLUDED.waitlisted_at),
      updated_at        = now()
    RETURNING * INTO v_rsvp;
  ELSE
    INSERT INTO rsvps (event_id, guest_id, status, waitlist_position, waitlisted_at)
    VALUES (p_event_id, p_guest_id, p_status, NULL, NULL)
    ON CONFLICT (event_id, guest_id)
    DO UPDATE SET
      status            = EXCLUDED.status,
      waitlist_position = NULL,
      waitlisted_at     = NULL,
      updated_at        = now()
    RETURNING * INTO v_rsvp;
  END IF;

  RETURN v_rsvp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
