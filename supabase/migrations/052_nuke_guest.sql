-- ============================================================
-- 052: nuke_guest RPC.
--
-- Test-data cleanup helper: hard-deletes a guest plus everything
-- pointing at them. Most child tables already CASCADE on delete, so
-- this is mostly bookkeeping for the two FKs that don't:
--   - notifications_log.guest_id  (default NO ACTION)
--   - invites.invited_by          (default NO ACTION)
--
-- Returns counts so the admin UI can show what was wiped. Idempotent:
-- a second call on the same id returns guest_found=false without
-- raising.
-- ============================================================

CREATE OR REPLACE FUNCTION nuke_guest(p_guest_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest          guests;
  v_rsvps          INT;
  v_orders         INT;
  v_pickup_orders  INT;
  v_notifications  INT;
  v_invites_sent   INT;
  v_magic_links    INT;
  v_ambient_tokens INT;
BEGIN
  IF p_guest_id IS NULL THEN
    RETURN jsonb_build_object('guest_found', false, 'reason', 'null_id');
  END IF;

  SELECT * INTO v_guest FROM guests WHERE id = p_guest_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('guest_found', false);
  END IF;

  -- Snapshot counts before delete so the caller can report what got wiped.
  SELECT COUNT(*) INTO v_rsvps          FROM rsvps             WHERE guest_id   = p_guest_id;
  SELECT COUNT(*) INTO v_orders         FROM orders            WHERE guest_id   = p_guest_id;
  SELECT COUNT(*) INTO v_pickup_orders  FROM pickup_orders     WHERE guest_id   = p_guest_id;
  SELECT COUNT(*) INTO v_notifications  FROM notifications_log WHERE guest_id   = p_guest_id;
  SELECT COUNT(*) INTO v_invites_sent   FROM invites           WHERE invited_by = p_guest_id;
  SELECT COUNT(*) INTO v_magic_links    FROM magic_links       WHERE guest_id   = p_guest_id;
  SELECT COUNT(*) INTO v_ambient_tokens FROM ambient_tokens    WHERE guest_id   = p_guest_id;

  -- Manual cleanup for the FKs that don't CASCADE.
  DELETE FROM notifications_log WHERE guest_id   = p_guest_id;
  DELETE FROM invites           WHERE invited_by = p_guest_id;

  -- Cascade handles the rest:
  --   rsvps (incl. plus_one_of children), orders, order_items,
  --   pickup_orders, pickup_order_items, magic_links,
  --   merge_verifications, unsubscribe_log, ambient_tokens.
  -- SET NULL: rsvps.referred_by_guest_id, invites.consumed_by_guest_id,
  --   bulk_invite_job_recipients.guest_id.
  DELETE FROM guests WHERE id = p_guest_id;

  RETURN jsonb_build_object(
    'guest_found',    true,
    'guest_id',       p_guest_id,
    'first_name',     v_guest.first_name,
    'last_name',      v_guest.last_name,
    'rsvps',          v_rsvps,
    'orders',         v_orders,
    'pickup_orders',  v_pickup_orders,
    'notifications',  v_notifications,
    'invites_sent',   v_invites_sent,
    'magic_links',    v_magic_links,
    'ambient_tokens', v_ambient_tokens
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION nuke_guest(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nuke_guest(UUID) TO authenticated;

COMMENT ON FUNCTION nuke_guest(UUID) IS
  'Admin test-data helper: hard-deletes a guest and every record pointing at them. Returns JSONB with counts of what was wiped.';
