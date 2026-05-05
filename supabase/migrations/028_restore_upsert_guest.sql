-- ============================================================
-- Restore the production upsert_guest definition.
--
-- Migration 026 temporarily replaced upsert_guest with a version
-- that emitted RAISE NOTICE logs to diagnose duplicate-RSVP creation.
-- The duplicate bug turned out to be schema drift (waitlist columns
-- missing, fixed in 027) plus orphan guest rows accumulating from
-- earlier failed cycles, not a defect in upsert_guest itself.
-- This migration drops the diagnostic logging and restores the
-- function to the body originally defined in 020_upsert_guest.sql.
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

  -- Path 1: caller already knows the guest_id. Update that row directly.
  IF p_guest_id IS NOT NULL THEN
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

    IF v_guest IS NOT NULL THEN
      RETURN v_guest;
    END IF;
    -- Stale localStorage id (row was deleted): fall through to dedup/insert.
  END IF;

  -- Path 2: dedup by email then phone. Most-recent match wins.
  IF v_email IS NOT NULL THEN
    SELECT * INTO v_guest FROM guests
      WHERE lower(email) = lower(v_email)
      ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_guest IS NULL AND v_phone IS NOT NULL THEN
    SELECT * INTO v_guest FROM guests
      WHERE phone = v_phone
      ORDER BY created_at DESC LIMIT 1;
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
  END IF;

  RETURN v_guest;
END;
$$;

REVOKE EXECUTE ON FUNCTION upsert_guest(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_guest(JSONB, UUID) TO anon, authenticated;
