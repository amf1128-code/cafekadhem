-- ============================================================
-- 060: Per-channel opt-out for guest notifications.
--
-- The single-enum notification_preference model conflated two things:
-- which channels we have on file, and which channels you opted out of.
-- That made partial unsubscribes impossible (a STOP on SMS killed
-- email too; an inferred 'sms' froze a both-contacts guest out of
-- email forever).
--
-- New model:
--   - email / phone columns        : what we have on file
--   - opted_out_channels TEXT[]    : what you explicitly killed
--   - notification_preference      : DERIVED MIRROR, auto-synced
--
-- Effective rule:
--   send on channel C iff (we have contact for C)
--                    AND (C NOT IN opted_out_channels)
--
-- Every existing reader (send-notification, send-blast, bulk-invite,
-- EventBlast) keeps reading notification_preference unchanged — it
-- just becomes correct. The writers that used to set the enum
-- directly (record_unsubscribe, START webhook, upsert_guest's
-- inferred-pref logic) now write to opted_out_channels or contacts;
-- a BEFORE trigger derives the mirror.
--
-- Backfill is conservative: legacy 'none' rows with no per-channel
-- unsubscribe_log history are treated as opted-out on every channel
-- they have contact for. We never silently re-enable a suppressed
-- contact.
-- ============================================================

-- 1. New column. CHECK pins values to known channel names; future
--    additions (push, whatsapp) extend the array.
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS opted_out_channels TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE guests
  DROP CONSTRAINT IF EXISTS guests_opted_out_channels_check;

ALTER TABLE guests
  ADD CONSTRAINT guests_opted_out_channels_check
  CHECK (opted_out_channels <@ ARRAY['sms', 'email']::TEXT[]);

COMMENT ON COLUMN guests.opted_out_channels IS
  $cmt$Channels the guest explicitly opted out of (SMS STOP, email unsubscribe). Source of truth — notification_preference is a derived mirror, auto-synced by the guests_sync_notification_preference trigger.$cmt$;

-- 2. Backfill from unsubscribe_log: every row there records a real
--    per-channel opt-out, with the channel preserved.
WITH per_guest AS (
  SELECT guest_id, array_agg(DISTINCT channel ORDER BY channel) AS chans
    FROM unsubscribe_log
   GROUP BY guest_id
)
UPDATE guests g
   SET opted_out_channels = pg.chans
  FROM per_guest pg
 WHERE g.id = pg.guest_id;

-- 3. Conservative backfill for legacy 'none' rows with no log entries
--    (e.g. admin-set 'none', or unsubscribes from before migration 040
--    landed). We can't tell which channel was killed, so we opt them
--    out of every channel they have contact for. They were silent
--    before; they stay silent.
UPDATE guests
   SET opted_out_channels = (
     SELECT COALESCE(array_agg(c ORDER BY c), '{}'::TEXT[])
       FROM (
         SELECT 'sms'::TEXT   AS c WHERE phone IS NOT NULL
         UNION ALL
         SELECT 'email'::TEXT AS c WHERE email IS NOT NULL
       ) s
   )
 WHERE notification_preference = 'none'
   AND opted_out_channels = '{}'::TEXT[];

-- 4. Derivation. Result is one of 'both' | 'sms' | 'email' | 'none',
--    matching the existing notification_preference CHECK constraint
--    (set up in migration 039).
CREATE OR REPLACE FUNCTION derive_notification_preference(
  p_email              TEXT,
  p_phone              TEXT,
  p_opted_out_channels TEXT[]
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_opt_out   TEXT[]  := COALESCE(p_opted_out_channels, '{}'::TEXT[]);
  v_can_sms   BOOLEAN := p_phone IS NOT NULL AND p_phone <> ''
                          AND NOT ('sms'   = ANY(v_opt_out));
  v_can_email BOOLEAN := p_email IS NOT NULL AND p_email <> ''
                          AND NOT ('email' = ANY(v_opt_out));
BEGIN
  RETURN CASE
    WHEN v_can_sms AND v_can_email THEN 'both'
    WHEN v_can_sms                 THEN 'sms'
    WHEN v_can_email               THEN 'email'
    ELSE 'none'
  END;
END;
$$;

-- 5. Trigger keeps notification_preference in sync with (email, phone,
--    opted_out_channels). BEFORE so the value is written in the same
--    row write — no second update, no race. Anything a caller writes
--    to notification_preference directly is overridden here (by
--    design: the column is a mirror, not an input).
CREATE OR REPLACE FUNCTION sync_notification_preference()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.notification_preference :=
    derive_notification_preference(NEW.email, NEW.phone, NEW.opted_out_channels);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guests_sync_notification_preference ON guests;
CREATE TRIGGER guests_sync_notification_preference
  BEFORE INSERT OR UPDATE ON guests
  FOR EACH ROW
  EXECUTE FUNCTION sync_notification_preference();

-- 6. One-shot recompute for every existing row, so the derived value
--    reflects the freshly-backfilled opt-out state. Touching
--    updated_at is enough to fire the trigger.
UPDATE guests SET updated_at = updated_at;

-- 7. record_unsubscribe: append the channel to opted_out_channels.
--    The trigger narrows notification_preference accordingly.
CREATE OR REPLACE FUNCTION record_unsubscribe(
  p_guest_id UUID,
  p_channel  TEXT,
  p_source   TEXT,
  p_payload  JSONB DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_channel NOT IN ('sms', 'email') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;

  INSERT INTO unsubscribe_log (guest_id, channel, source, raw_payload)
  VALUES (p_guest_id, p_channel, p_source, p_payload);

  -- Add channel if absent. CHECK constraint pins values, so the
  -- array stays a sorted-unique subset of {'sms','email'}.
  UPDATE guests
     SET opted_out_channels = (
           SELECT array_agg(DISTINCT c ORDER BY c)
             FROM unnest(opted_out_channels || ARRAY[p_channel]) AS c
         ),
         updated_at = now()
   WHERE id = p_guest_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_unsubscribe(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_unsubscribe(UUID, TEXT, TEXT, JSONB)
  TO service_role;

-- 8. record_resubscribe: inverse of record_unsubscribe. Called by the
--    SMS START webhook and any future "turn email back on" admin or
--    guest UI. Removes the channel from opted_out_channels without
--    touching contacts; the trigger broadens notification_preference
--    accordingly.
CREATE OR REPLACE FUNCTION record_resubscribe(
  p_guest_id UUID,
  p_channel  TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_channel NOT IN ('sms', 'email') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;

  UPDATE guests
     SET opted_out_channels = array_remove(opted_out_channels, p_channel),
         updated_at = now()
   WHERE id = p_guest_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_resubscribe(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_resubscribe(UUID, TEXT) TO service_role;

-- 9. merge_guests: union the opt-out arrays so a STOP on either side
--    carries through the merge. Replaces the legacy "if either was
--    'none', kept is 'none'" check (the trigger handles the
--    derivation now). Behavior otherwise identical to migration 045.
CREATE OR REPLACE FUNCTION merge_guests(
  p_keep_id UUID,
  p_drop_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep guests;
  v_drop guests;
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
    RETURN jsonb_build_object('merged', false, 'reason', 'drop_not_found');
  END IF;

  WITH conflicts AS (
    SELECT k.id AS keep_rsvp_id, d.id AS drop_rsvp_id,
           k.payment_status AS keep_payment, d.payment_status AS drop_payment,
           k.status AS keep_status, d.status AS drop_status
    FROM rsvps k
    JOIN rsvps d ON d.event_id = k.event_id
                AND d.plus_one_of IS NULL AND k.plus_one_of IS NULL
    WHERE k.guest_id = p_keep_id AND d.guest_id = p_drop_id
  ),
  ranked AS (
    SELECT keep_rsvp_id, drop_rsvp_id,
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
  DELETE FROM rsvps WHERE id IN (
    SELECT CASE WHEN keep_rank >= drop_rank THEN drop_rsvp_id ELSE keep_rsvp_id END
      FROM ranked
  );

  UPDATE rsvps             SET guest_id              = p_keep_id WHERE guest_id              = p_drop_id;
  UPDATE rsvps             SET referred_by_guest_id  = p_keep_id WHERE referred_by_guest_id  = p_drop_id;
  UPDATE orders            SET guest_id              = p_keep_id WHERE guest_id              = p_drop_id;
  UPDATE pickup_orders     SET guest_id              = p_keep_id WHERE guest_id              = p_drop_id;
  UPDATE invites           SET invited_by            = p_keep_id WHERE invited_by            = p_drop_id;
  UPDATE invites           SET consumed_by_guest_id  = p_keep_id WHERE consumed_by_guest_id  = p_drop_id;
  UPDATE notifications_log SET guest_id              = p_keep_id WHERE guest_id              = p_drop_id;
  UPDATE magic_links       SET guest_id              = p_keep_id WHERE guest_id              = p_drop_id;
  UPDATE unsubscribe_log   SET guest_id              = p_keep_id WHERE guest_id              = p_drop_id;
  UPDATE ambient_tokens    SET guest_id              = p_keep_id WHERE guest_id              = p_drop_id;

  UPDATE guests SET
    email      = COALESCE(email,     v_drop.email),
    phone      = COALESCE(phone,     v_drop.phone),
    last_name  = COALESCE(last_name, v_drop.last_name),
    instagram  = COALESCE(instagram, v_drop.instagram),
    -- Sticky-union the opt-outs: a STOP on either side survives the
    -- merge. The trigger recomputes notification_preference from the
    -- merged (email, phone, opted_out_channels) state.
    opted_out_channels = (
      SELECT COALESCE(array_agg(DISTINCT c ORDER BY c), '{}'::TEXT[])
        FROM unnest(v_keep.opted_out_channels || v_drop.opted_out_channels) AS c
    ),
    updated_at = now()
  WHERE id = p_keep_id;

  DELETE FROM guests WHERE id = p_drop_id;

  RETURN jsonb_build_object('merged', true, 'kept', p_keep_id, 'dropped', p_drop_id);
END;
$$;

-- 10. upsert_guest: drop the v_pref / v_inferred_pref logic. The
--     trigger derives notification_preference from the freshly-
--     written (email, phone, opted_out_channels) — which is exactly
--     the "union of channels on file" the old inferred rule was
--     trying to express, but applied on every upsert (not just
--     inserts) and without ever narrowing an existing 'both' guest
--     down to one channel just because the old preference was 'sms'.
--     Behavior otherwise identical to migration 042.
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
      first_name = v_first,
      last_name  = CASE WHEN p_fields ? 'last_name'
                        THEN NULLIF(trim(p_fields->>'last_name'), '')
                        ELSE last_name END,
      email      = v_email,
      phone      = v_phone,
      instagram  = CASE WHEN p_fields ? 'instagram'
                        THEN NULLIF(trim(p_fields->>'instagram'), '')
                        ELSE instagram END,
      updated_at = now()
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
        first_name = v_first,
        last_name  = CASE WHEN p_fields ? 'last_name'
                          THEN NULLIF(trim(p_fields->>'last_name'), '')
                          ELSE last_name END,
        email      = v_email,
        phone      = v_phone,
        instagram  = CASE WHEN p_fields ? 'instagram'
                          THEN NULLIF(trim(p_fields->>'instagram'), '')
                          ELSE instagram END,
        updated_at = now()
      WHERE id = v_target
      RETURNING * INTO v_guest;

      RETURN to_jsonb(v_guest) || jsonb_build_object('pending_merge', v_pending_merge);
    END IF;
  END IF;

  -- Path 1: explicit p_guest_id (no collision detected above).
  IF p_guest_id IS NOT NULL THEN
    UPDATE guests SET
      first_name = v_first,
      last_name  = CASE WHEN p_fields ? 'last_name'
                        THEN NULLIF(trim(p_fields->>'last_name'), '')
                        ELSE last_name END,
      email      = v_email,
      phone      = v_phone,
      instagram  = CASE WHEN p_fields ? 'instagram'
                        THEN NULLIF(trim(p_fields->>'instagram'), '')
                        ELSE instagram END,
      updated_at = now()
    WHERE id = p_guest_id
    RETURNING * INTO v_guest;

    IF v_guest.id IS NOT NULL THEN
      RETURN to_jsonb(v_guest) || jsonb_build_object('pending_merge', NULL);
    END IF;
  END IF;

  -- Path 2: dedup by email then phone.
  IF v_email_match IS NOT NULL THEN
    UPDATE guests SET
      first_name = v_first,
      last_name  = CASE WHEN p_fields ? 'last_name'
                        THEN NULLIF(trim(p_fields->>'last_name'), '')
                        ELSE last_name END,
      email      = v_email,
      phone      = v_phone,
      instagram  = CASE WHEN p_fields ? 'instagram'
                        THEN NULLIF(trim(p_fields->>'instagram'), '')
                        ELSE instagram END,
      updated_at = now()
    WHERE id = v_email_match
    RETURNING * INTO v_guest;
  ELSIF v_phone_match IS NOT NULL THEN
    UPDATE guests SET
      first_name = v_first,
      last_name  = CASE WHEN p_fields ? 'last_name'
                        THEN NULLIF(trim(p_fields->>'last_name'), '')
                        ELSE last_name END,
      email      = v_email,
      phone      = v_phone,
      instagram  = CASE WHEN p_fields ? 'instagram'
                        THEN NULLIF(trim(p_fields->>'instagram'), '')
                        ELSE instagram END,
      updated_at = now()
    WHERE id = v_phone_match
    RETURNING * INTO v_guest;
  ELSE
    INSERT INTO guests (
      first_name, last_name, email, phone, instagram
    ) VALUES (
      v_first,
      NULLIF(trim(p_fields->>'last_name'), ''),
      v_email,
      v_phone,
      NULLIF(trim(p_fields->>'instagram'), '')
    )
    RETURNING * INTO v_guest;
  END IF;

  RETURN to_jsonb(v_guest) || jsonb_build_object('pending_merge', NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION upsert_guest(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_guest(JSONB, UUID) TO anon, authenticated;

COMMENT ON COLUMN guests.notification_preference IS
  $cmt$DERIVED MIRROR — auto-recomputed from (email, phone, opted_out_channels) by the guests_sync_notification_preference trigger. Do not write to this column directly; modify opted_out_channels (via record_unsubscribe / record_resubscribe) or contacts instead.$cmt$;
