-- ============================================================
-- 033: Replace safe_create_rsvp.
--
-- Changes vs migration 025:
--   1. pg_advisory_xact_lock keyed on event_id at the top, so
--      concurrent yes-RSVPs serialize through the capacity check.
--   2. Block status transitions away from 'yes' when payment_status='paid'.
--      Refund must come first (admin: mark_rsvp_unpaid).
--      USER_FLOWS_SPEC.md §4.3.
--
-- Preserved from 025: contact-based dedup at the top so a stale
-- localStorage guest_id doesn't cause duplicate RSVP rows.
--
-- Return type unchanged (rsvps row); existing callers are not affected.
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
  v_existing        rsvps;
BEGIN
  -- Serialize the capacity check + insert against this event.
  -- Released at COMMIT/ROLLBACK; concurrent senders queue here.
  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || p_event_id::text));

  -- Dedup: if another non-plus-one RSVP already exists for this event
  -- from a guest whose email/phone matches the incoming guest, use that
  -- guest's id. Collapses accidental duplicate-guest records back onto
  -- the original RSVP row via the ON CONFLICT path below.
  SELECT r.guest_id INTO v_canonical_guest
  FROM   rsvps r
  JOIN   guests g_new      ON g_new.id      = p_guest_id
  JOIN   guests g_existing ON g_existing.id = r.guest_id
  WHERE  r.event_id    = p_event_id
    AND  r.plus_one_of IS NULL
    AND  r.guest_id   != p_guest_id
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

  -- Block status transitions away from 'yes' on a paid RSVP.
  -- Lookup the existing row (if any) and check.
  SELECT * INTO v_existing
  FROM   rsvps
  WHERE  event_id = p_event_id
    AND  guest_id = p_guest_id
    AND  plus_one_of IS NULL;

  IF v_existing.payment_status = 'paid' AND p_status <> 'yes' THEN
    RAISE EXCEPTION 'paid_rsvp_cannot_change_status'
      USING HINT = 'Refund (admin: mark_rsvp_unpaid) before changing status.';
  END IF;

  -- Capacity check (only for 'yes' requests on capacity-bounded events)
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
