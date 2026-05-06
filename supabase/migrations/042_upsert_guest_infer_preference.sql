-- ============================================================
-- 042: Replace upsert_guest body with one that infers
-- notification_preference from the filled fields when the caller
-- doesn't provide one.
--
-- Inference rules (USER_FLOWS_SPEC.md §7.1):
--   email + phone provided → 'both'
--   phone only             → 'sms'
--   email only             → 'email'
--
-- Inference only fires for new inserts and for updates where the
-- existing preference is NULL. Existing explicit preferences (e.g.
-- 'none' set by an unsubscribe webhook, or a deliberate 'email' set
-- by the guest in Settings) are preserved verbatim.
--
-- All other behavior identical to migration 038. Validation now
-- accepts 'both' (added in migration 039).
-- ============================================================

DROP FUNCTION IF EXISTS upsert_guest(JSONB, UUID);

CREATE OR REPLACE FUNCTION upsert_guest(
  p_fields   JSONB,
  p_guest_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first         TEXT := NULLIF(trim(p_fields->>'first_name'), '');
  v_email         TEXT := NULLIF(trim(p_fields->>'email'), '');
  v_phone         TEXT := NULLIF(trim(p_fields->>'phone'), '');
  v_pref          TEXT := NULLIF(trim(p_fields->>'notification_preference'), '');
  v_inferred_pref TEXT;
  v_email_match   UUID;
  v_phone_match   UUID;
  v_keep          UUID;
  v_drop          UUID;
  v_target        UUID;
  v_guest         guests;
  v_pending_merge JSONB := NULL;
  v_token         TEXT;
BEGIN
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'first_name required';
  END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'email or phone required';
  END IF;
  IF v_pref IS NOT NULL AND v_pref NOT IN ('sms', 'email', 'both', 'none') THEN
    RAISE EXCEPTION 'invalid notification_preference';
  END IF;

  -- Inferred preference based on which channels were submitted.
  v_inferred_pref := CASE
    WHEN v_email IS NOT NULL AND v_phone IS NOT NULL THEN 'both'
    WHEN v_phone IS NOT NULL THEN 'sms'
    WHEN v_email IS NOT NULL THEN 'email'
    ELSE NULL
  END;

  IF v_email IS NOT NULL THEN
    SELECT id INTO v_email_match FROM guests
      WHERE lower(email) = lower(v_email)
      ORDER BY created_at DESC
      LIMIT 1;
  END IF;

  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_phone_match FROM guests
      WHERE phone = v_phone
      ORDER BY created_at DESC
      LIMIT 1;
  END IF;

  -- Case A: dual-channel collision → auto-merge inline.
  IF v_email_match IS NOT NULL
     AND v_phone_match IS NOT NULL
     AND v_email_match <> v_phone_match THEN

    SELECT
      CASE WHEN ge.created_at <= gp.created_at THEN ge.id ELSE gp.id END,
      CASE WHEN ge.created_at <= gp.created_at THEN gp.id ELSE ge.id END
      INTO v_keep, v_drop
      FROM guests ge, guests gp
     WHERE ge.id = v_email_match
       AND gp.id = v_phone_match;

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
      notification_preference = COALESCE(v_pref, notification_preference, v_inferred_pref),
      updated_at              = now()
    WHERE id = v_keep
    RETURNING * INTO v_guest;

    PERFORM merge_guests(v_keep, v_drop);

    RETURN to_jsonb(v_guest) || jsonb_build_object('pending_merge', NULL);
  END IF;

  -- Case B: single-channel collision against cached p_guest_id.
  IF p_guest_id IS NOT NULL THEN
    IF v_email_match IS NOT NULL AND v_email_match <> p_guest_id THEN
      v_target := v_email_match;
      v_pending_merge := jsonb_build_object(
        'from', p_guest_id, 'to', v_target, 'channel', 'email'
      );
    ELSIF v_phone_match IS NOT NULL AND v_phone_match <> p_guest_id THEN
      v_target := v_phone_match;
      v_pending_merge := jsonb_build_object(
        'from', p_guest_id, 'to', v_target, 'channel', 'sms'
      );
    END IF;

    IF v_pending_merge IS NOT NULL THEN
      SELECT
        CASE WHEN gp.created_at <= gt.created_at THEN p_guest_id ELSE v_target END,
        CASE WHEN gp.created_at <= gt.created_at THEN v_target ELSE p_guest_id END
        INTO v_keep, v_drop
        FROM guests gp, guests gt
       WHERE gp.id = p_guest_id
         AND gt.id = v_target;

      v_token := (request_merge_verification(
        v_keep, v_drop, v_pending_merge->>'channel'
      ))->>'token';

      v_pending_merge := v_pending_merge
        || jsonb_build_object('verification_token', v_token);

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
        notification_preference = COALESCE(v_pref, notification_preference, v_inferred_pref),
        updated_at              = now()
      WHERE id = v_target
      RETURNING * INTO v_guest;

      RETURN to_jsonb(v_guest) || jsonb_build_object('pending_merge', v_pending_merge);
    END IF;
  END IF;

  -- Path 1: explicit p_guest_id (no collision detected above).
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
      notification_preference = COALESCE(v_pref, notification_preference, v_inferred_pref),
      updated_at              = now()
    WHERE id = p_guest_id
    RETURNING * INTO v_guest;

    IF v_guest.id IS NOT NULL THEN
      RETURN to_jsonb(v_guest) || jsonb_build_object('pending_merge', NULL);
    END IF;
  END IF;

  -- Path 2: dedup by email then phone (preserved from migration 028).
  IF v_email_match IS NOT NULL THEN
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
      notification_preference = COALESCE(v_pref, notification_preference, v_inferred_pref),
      updated_at              = now()
    WHERE id = v_email_match
    RETURNING * INTO v_guest;
  ELSIF v_phone_match IS NOT NULL THEN
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
      notification_preference = COALESCE(v_pref, notification_preference, v_inferred_pref),
      updated_at              = now()
    WHERE id = v_phone_match
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
      COALESCE(v_pref, v_inferred_pref, 'email')
    )
    RETURNING * INTO v_guest;
  END IF;

  RETURN to_jsonb(v_guest) || jsonb_build_object('pending_merge', NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION upsert_guest(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_guest(JSONB, UUID) TO anon, authenticated;
