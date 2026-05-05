-- ============================================================
-- upsert_guest — combined contact-dedup-or-update-by-id flow used by
-- the public RSVP / Order / Pickup forms. Returns the resulting guest
-- row. Adding this in its own migration so the running site (which
-- still does the dedup via direct table reads) is unaffected; the
-- client switches to this function in the next change.
--
-- Fields are passed as a JSONB object. Only keys actually present in
-- the JSONB get written; absent keys preserve the existing column.
-- This mirrors how PostgREST `.update({...})` worked: an Order form
-- that only collects first/email/phone cannot blow away a last_name
-- the guest set on a different form.
--
-- Trust model is unchanged from today. Knowing a guest_id (from the
-- localStorage cookie) acts as that guest; without one, a contact
-- match returns the existing row to update so we do not pile up
-- duplicate guests for the same email/phone.
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

  -- Path 1: caller already knows the guest_id. Update that row directly
  -- so a guest editing their own email cannot accidentally collide with
  -- a stranger who happens to match the new value.
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

  -- Path 2: dedup by email then phone. Most-recent match wins so legacy
  -- duplicate rows are still reachable rather than orphaning the user.
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
