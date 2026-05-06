-- ============================================================
-- 036: merge_guests RPC.
--
-- Reassigns FKs from p_drop_id → p_keep_id, then deletes p_drop_id.
-- Idempotent: safe to call twice with the same args (drop won't exist
-- the second time).
--
-- Conflict resolution: if both rows have an RSVP for the same event,
-- the one with the higher-ranked status survives and the other is
-- deleted (its plus-ones cascade-delete via plus_one_of FK).
-- Status ranking: paid > yes > waitlisted > maybe > no.
--
-- USER_FLOWS_SPEC.md §3.4 Case A.
-- ============================================================

CREATE OR REPLACE FUNCTION merge_guests(
  p_keep_id UUID,
  p_drop_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep   guests;
  v_drop   guests;
BEGIN
  IF p_keep_id IS NULL OR p_drop_id IS NULL THEN
    RETURN jsonb_build_object('merged', false, 'reason', 'null_id');
  END IF;

  IF p_keep_id = p_drop_id THEN
    RETURN jsonb_build_object('merged', false, 'reason', 'same_id');
  END IF;

  SELECT * INTO v_keep FROM guests WHERE id = p_keep_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_guests: keep_id % not found', p_keep_id;
  END IF;

  SELECT * INTO v_drop FROM guests WHERE id = p_drop_id;
  IF NOT FOUND THEN
    -- Already merged or never existed — idempotent no-op.
    RETURN jsonb_build_object('merged', false, 'reason', 'drop_not_found');
  END IF;

  -- ============================================================
  -- 1. RSVP conflict resolution.
  --    For each event where both guests have an RSVP, keep the one
  --    with the higher status rank; delete the other.
  --    (paid > yes > waitlisted > maybe > no.)
  --    Plus-ones whose plus_one_of points to a deleted parent will
  --    cascade-delete via the plus_one_of FK.
  -- ============================================================
  WITH conflicts AS (
    SELECT
      k.id  AS keep_rsvp_id,
      d.id  AS drop_rsvp_id,
      k.payment_status AS keep_payment,
      d.payment_status AS drop_payment,
      k.status AS keep_status,
      d.status AS drop_status
    FROM rsvps k
    JOIN rsvps d
      ON d.event_id = k.event_id
     AND d.plus_one_of IS NULL
     AND k.plus_one_of IS NULL
    WHERE k.guest_id = p_keep_id
      AND d.guest_id = p_drop_id
  ),
  ranked AS (
    SELECT
      keep_rsvp_id,
      drop_rsvp_id,
      CASE WHEN keep_payment = 'paid' THEN 5
           WHEN keep_status = 'yes' THEN 4
           WHEN keep_status = 'waitlisted' THEN 3
           WHEN keep_status = 'maybe' THEN 2
           WHEN keep_status = 'no' THEN 1
           ELSE 0 END AS keep_rank,
      CASE WHEN drop_payment = 'paid' THEN 5
           WHEN drop_status = 'yes' THEN 4
           WHEN drop_status = 'waitlisted' THEN 3
           WHEN drop_status = 'maybe' THEN 2
           WHEN drop_status = 'no' THEN 1
           ELSE 0 END AS drop_rank
    FROM conflicts
  )
  DELETE FROM rsvps
   WHERE id IN (
     SELECT CASE WHEN keep_rank >= drop_rank
                 THEN drop_rsvp_id
                 ELSE keep_rsvp_id END
       FROM ranked
   );

  -- ============================================================
  -- 2. Reassign FKs from drop → keep.
  --    rsvps.plus_one_of references rsvps.id (not guests.id), so it
  --    doesn't need touching here.
  -- ============================================================
  UPDATE rsvps             SET guest_id             = p_keep_id WHERE guest_id             = p_drop_id;
  UPDATE orders            SET guest_id             = p_keep_id WHERE guest_id             = p_drop_id;
  UPDATE pickup_orders     SET guest_id             = p_keep_id WHERE guest_id             = p_drop_id;
  UPDATE invites           SET invited_by           = p_keep_id WHERE invited_by           = p_drop_id;
  UPDATE invites           SET consumed_by_guest_id = p_keep_id WHERE consumed_by_guest_id = p_drop_id;
  UPDATE notifications_log SET guest_id             = p_keep_id WHERE guest_id             = p_drop_id;
  UPDATE magic_links       SET guest_id             = p_keep_id WHERE guest_id             = p_drop_id;
  -- ambient_tokens (Commit 4) and unsubscribe_log (Commit 3) will be
  -- added to this list when those tables exist; merge_guests will be
  -- re-issued in those commits.

  -- ============================================================
  -- 3. Field merge: copy non-null drop fields into keep where keep
  --    has a NULL. The caller (upsert_guest) has already written the
  --    latest submission's fields into keep, so this only fills gaps.
  -- ============================================================
  UPDATE guests
     SET email      = COALESCE(email,      v_drop.email),
         phone      = COALESCE(phone,      v_drop.phone),
         last_name  = COALESCE(last_name,  v_drop.last_name),
         instagram  = COALESCE(instagram,  v_drop.instagram),
         updated_at = now()
   WHERE id = p_keep_id;

  -- ============================================================
  -- 4. Suppression sticky: if either row had 'none', merged is 'none'.
  -- ============================================================
  IF v_drop.notification_preference = 'none'
     OR v_keep.notification_preference = 'none' THEN
    UPDATE guests SET notification_preference = 'none' WHERE id = p_keep_id;
  END IF;

  -- ============================================================
  -- 5. Drop the merged row. Any FK we forgot will fail here and roll
  --    the whole transaction back, surfacing the bug.
  -- ============================================================
  DELETE FROM guests WHERE id = p_drop_id;

  RETURN jsonb_build_object(
    'merged',  true,
    'kept',    p_keep_id,
    'dropped', p_drop_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION merge_guests(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_guests(UUID, UUID) TO authenticated;
