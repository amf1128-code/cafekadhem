-- ============================================================
-- 046: Allow paid RSVPs to change status to maybe / no.
--
-- Reverses the `paid_rsvp_cannot_change_status` block added in
-- migration 033. New policy (per user, 2026-05-06):
--
--   - A paid guest CAN change their RSVP to maybe or no.
--   - The RSVP row keeps payment_status='paid' and ticket_token so
--     the QR remains valid at the door (in case they change their mind).
--   - The host sees the row in the admin Tickets page (filter on
--     payment activity, not on RSVP status — frontend change in same commit)
--     and can mark_rsvp_unpaid / mark_refunded if they want to invalidate.
--   - Plus-ones get cleaned up automatically by the existing
--     sync_plus_one_status trigger when parent leaves yes/waitlisted.
--
-- USER_FLOWS_SPEC.md §4.3.
--
-- Body identical to migration 033 except for the removal of the
-- `IF v_existing.payment_status = 'paid' AND p_status <> 'yes'` block.
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
  -- Serialize the capacity check + insert against this event.
  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || p_event_id::text));

  -- Contact-based dedup (preserved from migration 025).
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

  -- Capacity check (only for 'yes' on capacity-bounded events).
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

  -- Upsert.
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
