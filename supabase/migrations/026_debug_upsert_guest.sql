-- ============================================================
-- Temporary diagnostic build of upsert_guest.
--
-- Adds RAISE NOTICE logging so we can see exactly which branch
-- the function takes and whether path-1 actually finds the row.
-- Every RAISE NOTICE shows up in the Supabase database log viewer
-- (Dashboard → Database → Logs) and in the Postgres logs.
--
-- Remove this migration (or replace with 027_remove_debug.sql)
-- once the path-1 failure is understood.
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_guest(
  p_fields JSONB,
  p_guest_id UUID DEFAULT NULL
) RETURNS guests
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_guest guests;
  v_first TEXT := NULLIF(trim(p_fields->>'first_name'), '');
  v_email TEXT := NULLIF(trim(p_fields->>'email'), '');
  v_phone TEXT := NULLIF(trim(p_fields->>'phone'), '');
  v_pref  TEXT := NULLIF(trim(p_fields->>'notification_preference'), '');
  v_row_exists BOOLEAN;
BEGIN
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'first_name required';
  END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'email or phone required';
  END IF;
  IF v_pref IS NOT NULL AND v_pref NOT IN ('sms', 'email', 'none') THEN
    RAISE EXCEPTION 'invalid notification_preference';
  END IF;

  RAISE NOTICE '[upsert_guest] called with p_guest_id=% email=% phone=%',
    p_guest_id, v_email, v_phone;

  -- Path 1: update by id
  IF p_guest_id IS NOT NULL THEN
    -- Check whether the row exists before attempting the update so we
    -- can tell from the log whether it's a missing row or a silent failure.
    SELECT EXISTS(SELECT 1 FROM guests WHERE id = p_guest_id)
      INTO v_row_exists;

    RAISE NOTICE '[upsert_guest] path-1: row exists for id %: %',
      p_guest_id, v_row_exists;

    UPDATE guests SET
      first_name              = v_first,
      last_name               = CASE WHEN p_fields ? 'last_name'
                                     THEN NULLIF(trim(p_fields->>'last_name'), '')
                                     ELSE last_name END,
      email                   = v_email,
      phone                   = v_phone,
      instagram               = CASE WHEN p_fields ? 'instagram'
                                     THEN NULLIF(trim(p_fields->>'instagram'), '')
                                     ELSE instagram END,
      notification_preference = COALESCE(v_pref, notification_preference),
      updated_at              = now()
    WHERE id = p_guest_id
    RETURNING * INTO v_guest;

    RAISE NOTICE '[upsert_guest] path-1 UPDATE returned id=%',
      v_guest.id;  -- will be NULL if no row matched

    IF v_guest IS NOT NULL THEN
      RAISE NOTICE '[upsert_guest] path-1 SUCCESS returning %', v_guest.id;
      RETURN v_guest;
    END IF;

    RAISE NOTICE '[upsert_guest] path-1 MISS (0 rows) – falling through to email/phone dedup';
  END IF;

  -- Path 2: dedup by email then phone
  IF v_email IS NOT NULL THEN
    SELECT * INTO v_guest FROM guests
      WHERE lower(email) = lower(v_email)
      ORDER BY created_at DESC LIMIT 1;
    RAISE NOTICE '[upsert_guest] path-2 email dedup found id=%', v_guest.id;
  END IF;

  IF v_guest IS NULL AND v_phone IS NOT NULL THEN
    SELECT * INTO v_guest FROM guests
      WHERE phone = v_phone
      ORDER BY created_at DESC LIMIT 1;
    RAISE NOTICE '[upsert_guest] path-2 phone dedup found id=%', v_guest.id;
  END IF;

  IF v_guest IS NOT NULL THEN
    UPDATE guests SET
      first_name              = v_first,
      last_name               = CASE WHEN p_fields ? 'last_name'
                                     THEN NULLIF(trim(p_fields->>'last_name'), '')
                                     ELSE last_name END,
      email                   = v_email,
      phone                   = v_phone,
      instagram               = CASE WHEN p_fields ? 'instagram'
                                     THEN NULLIF(trim(p_fields->>'instagram'), '')
                                     ELSE instagram END,
      notification_preference = COALESCE(v_pref, notification_preference),
      updated_at              = now()
    WHERE id = v_guest.id
    RETURNING * INTO v_guest;
    RAISE NOTICE '[upsert_guest] path-2 UPDATE done, returning %', v_guest.id;
  ELSE
    INSERT INTO guests (
      first_name, last_name, email, phone, instagram, notification_preference
    ) VALUES (
      v_first,
      NULLIF(trim(p_fields->>'last_name'), ''),
      v_email,
      v_phone,
      NULLIF(trim(p_fields->>'instagram'), ''),
      COALESCE(v_pref, 'email')
    )
    RETURNING * INTO v_guest;
    RAISE NOTICE '[upsert_guest] path-3 INSERT new guest, id=%', v_guest.id;
  END IF;

  RETURN v_guest;
END;
$$;

REVOKE EXECUTE ON FUNCTION upsert_guest(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_guest(JSONB, UUID) TO anon, authenticated;
