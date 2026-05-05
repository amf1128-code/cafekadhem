-- =============================================================
-- Plus-one edit support: rename and remove RPCs.
-- Used when a host re-opens their RSVP and changes whether they're
-- bringing a +1 or who that +1 is.
-- =============================================================

-- Idempotent: returns silently if the id doesn't point at a +1 row,
-- so a stale client retry can't blow up. Drops the +1's guest row,
-- which cascades the RSVP via the existing rsvps.guest_id FK.
CREATE OR REPLACE FUNCTION remove_plus_one(p_plus_one_rsvp_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_guest_id UUID;
BEGIN
  SELECT guest_id INTO v_guest_id
  FROM rsvps
  WHERE id = p_plus_one_rsvp_id AND plus_one_of IS NOT NULL;
  IF v_guest_id IS NULL THEN
    RETURN;
  END IF;
  -- Cascades to the rsvp via guests -> rsvps.guest_id ON DELETE CASCADE.
  DELETE FROM guests WHERE id = v_guest_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION remove_plus_one(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_plus_one(UUID) TO anon, authenticated;

-- Bypasses upsert_guest's email-or-phone validation (a +1 has neither
-- by design). Refuses to operate on rows that aren't actually +1s,
-- so this can't be used to rename arbitrary guests by id.
CREATE OR REPLACE FUNCTION rename_plus_one(
  p_plus_one_rsvp_id UUID,
  p_first_name TEXT
) RETURNS guests
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_guest_id UUID;
  v_first TEXT := NULLIF(trim(p_first_name), '');
  v_guest guests;
BEGIN
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'first_name required';
  END IF;

  SELECT guest_id INTO v_guest_id
  FROM rsvps
  WHERE id = p_plus_one_rsvp_id AND plus_one_of IS NOT NULL;
  IF v_guest_id IS NULL THEN
    RAISE EXCEPTION 'Plus-one RSVP not found';
  END IF;

  UPDATE guests SET
    first_name = v_first,
    updated_at = now()
  WHERE id = v_guest_id
  RETURNING * INTO v_guest;

  RETURN v_guest;
END;
$$;

REVOKE EXECUTE ON FUNCTION rename_plus_one(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rename_plus_one(UUID, TEXT) TO anon, authenticated;
