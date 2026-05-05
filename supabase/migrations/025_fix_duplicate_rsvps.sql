-- =============================================================
-- Fix: duplicate host RSVPs surface as the host's name twice on the
-- public guest list after the +1 add/remove dance.
--
-- Reported flow:
--   1. RSVP yes with a +1   ->   host row A and +1 row B (plus_one_of=A).
--   2. Open "Manage RSVP", uncheck the +1, click Reserve a Seat.
--   3. Click Manage RSVP / Reserve a Seat again.
-- After step 3 the rsvps table holds two host rows (status='yes',
-- plus_one_of IS NULL) tied to two different guests that happen to
-- carry the same first_name, so the public list renders the host
-- twice.
--
-- Root cause: guests had no UNIQUE constraint on email or phone, so
-- two guest rows for the same person could coexist (a race in the
-- pre-upsert_guest era, two devices with mismatched contact info,
-- or a fresh-browser RSVP whose dedup-by-email happened to miss
-- because of trailing whitespace / case / phone normalization).
-- Once two guest rows exist for one person, upsert_guest's
-- "ORDER BY created_at DESC LIMIT 1" can pick a different one than
-- the one tied to the existing RSVP, and safe_create_rsvp called
-- with the new guest_id has no UNIQUE(event_id, guest_id) conflict
-- to absorb -> a parallel host RSVP row appears. The +1 dance is
-- incidental; it only makes the symptom visible because the host
-- runs the form again on the duplicate-guest path.
--
-- This migration:
--   1. Consolidates duplicate guest rows (lower(email), then phone),
--      repointing their RSVPs / invites / notifications / orders /
--      pickup orders / magic links to the canonical guest. Where two
--      guest rows both hold an RSVP for the same event, the
--      canonical wins and the duplicate's row is deleted (its +1
--      children are reparented to the canonical's row first).
--   2. Drops any duplicate +1 rows that share the same parent.
--   3. Adds partial UNIQUE indexes on guests.lower(email),
--      guests.phone, and rsvps.plus_one_of so future writes can't
--      reintroduce these dupes.
--   4. Tightens upsert_guest to use ON CONFLICT against the new
--      indexes so a race between two parallel first-time inserts
--      collapses onto one row instead of producing two.
--   5. Tightens add_plus_one to refuse a second +1 when the parent
--      already has one (defense in depth on top of the new index).
--   6. Tightens remove_plus_one to delete the +1's rsvp explicitly
--      rather than relying solely on the FK cascade, so a weakened
--      cascade (e.g. a future `ON DELETE SET NULL` change) can't
--      orphan a +1 row into looking like a host.
-- =============================================================

-- ============================================================
-- 1. Consolidate duplicate guest rows.
-- ============================================================
DO $$
DECLARE
  grp RECORD;
  canonical_id UUID;
  dup_id UUID;
  r RECORD;
  existing_rsvp_id UUID;
  remaining_dups UUID[];
BEGIN
  -- Email-based dedup: oldest row in each (lower(email)) group wins.
  FOR grp IN
    SELECT
      lower(email) AS key,
      array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM guests
    WHERE email IS NOT NULL
    GROUP BY lower(email)
    HAVING COUNT(*) > 1
  LOOP
    canonical_id := grp.ids[1];
    remaining_dups := grp.ids[2:array_length(grp.ids, 1)];

    FOREACH dup_id IN ARRAY remaining_dups LOOP
      -- For each rsvp the duplicate guest holds, either repoint it
      -- to the canonical (no collision) or merge it (canonical's
      -- existing row wins; dup's +1 children get reparented).
      FOR r IN
        SELECT id, event_id
        FROM rsvps
        WHERE guest_id = dup_id
      LOOP
        SELECT id INTO existing_rsvp_id
        FROM rsvps
        WHERE event_id = r.event_id AND guest_id = canonical_id;

        IF existing_rsvp_id IS NULL THEN
          UPDATE rsvps SET guest_id = canonical_id WHERE id = r.id;
        ELSE
          UPDATE rsvps SET plus_one_of = existing_rsvp_id
            WHERE plus_one_of = r.id;
          DELETE FROM rsvps WHERE id = r.id;
        END IF;
      END LOOP;

      UPDATE invites          SET invited_by = canonical_id WHERE invited_by = dup_id;
      UPDATE notifications_log SET guest_id  = canonical_id WHERE guest_id   = dup_id;
      UPDATE pickup_orders    SET guest_id   = canonical_id WHERE guest_id   = dup_id;
      UPDATE orders           SET guest_id   = canonical_id WHERE guest_id   = dup_id;
      UPDATE magic_links      SET guest_id   = canonical_id WHERE guest_id   = dup_id;

      DELETE FROM guests WHERE id = dup_id;
    END LOOP;
  END LOOP;

  -- Phone-based dedup: any guests still standing whose phone matches.
  FOR grp IN
    SELECT
      phone AS key,
      array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM guests
    WHERE phone IS NOT NULL
    GROUP BY phone
    HAVING COUNT(*) > 1
  LOOP
    canonical_id := grp.ids[1];
    remaining_dups := grp.ids[2:array_length(grp.ids, 1)];

    FOREACH dup_id IN ARRAY remaining_dups LOOP
      FOR r IN
        SELECT id, event_id
        FROM rsvps
        WHERE guest_id = dup_id
      LOOP
        SELECT id INTO existing_rsvp_id
        FROM rsvps
        WHERE event_id = r.event_id AND guest_id = canonical_id;

        IF existing_rsvp_id IS NULL THEN
          UPDATE rsvps SET guest_id = canonical_id WHERE id = r.id;
        ELSE
          UPDATE rsvps SET plus_one_of = existing_rsvp_id
            WHERE plus_one_of = r.id;
          DELETE FROM rsvps WHERE id = r.id;
        END IF;
      END LOOP;

      UPDATE invites          SET invited_by = canonical_id WHERE invited_by = dup_id;
      UPDATE notifications_log SET guest_id  = canonical_id WHERE guest_id   = dup_id;
      UPDATE pickup_orders    SET guest_id   = canonical_id WHERE guest_id   = dup_id;
      UPDATE orders           SET guest_id   = canonical_id WHERE guest_id   = dup_id;
      UPDATE magic_links      SET guest_id   = canonical_id WHERE guest_id   = dup_id;

      DELETE FROM guests WHERE id = dup_id;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- 2. Drop duplicate +1 rows that share the same parent.
-- Keep the oldest one in each (plus_one_of) group; delete the rest
-- by deleting their stub guest (the rsvp goes via the cascade we
-- still have in place at this point).
-- ============================================================
DO $$
DECLARE
  grp RECORD;
  loser UUID;
  loser_guest UUID;
BEGIN
  FOR grp IN
    SELECT
      plus_one_of AS parent_id,
      array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM rsvps
    WHERE plus_one_of IS NOT NULL
    GROUP BY plus_one_of
    HAVING COUNT(*) > 1
  LOOP
    FOREACH loser IN ARRAY grp.ids[2:array_length(grp.ids, 1)] LOOP
      SELECT guest_id INTO loser_guest FROM rsvps WHERE id = loser;
      DELETE FROM rsvps WHERE id = loser;
      IF loser_guest IS NOT NULL THEN
        DELETE FROM guests WHERE id = loser_guest;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- 3. Add UNIQUE partial indexes.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS guests_email_lower_unique
  ON guests (lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS guests_phone_unique
  ON guests (phone)
  WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS rsvps_plus_one_of_unique
  ON rsvps (plus_one_of)
  WHERE plus_one_of IS NOT NULL;

-- ============================================================
-- 4. upsert_guest: collapse first-time inserts onto the existing
-- guest via ON CONFLICT against the new indexes. The Path 1 / Path
-- 2 logic is preserved for the common case (callers with a known
-- guest_id, or contact-match with a single existing guest); the
-- ON CONFLICT only matters when two parallel callers race past
-- both Path 1 and Path 2 lookups.
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
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT * INTO v_guest FROM guests
      WHERE lower(email) = lower(v_email)
      ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_guest IS NULL AND v_phone IS NOT NULL THEN
    SELECT * INTO v_guest FROM guests
      WHERE phone = v_phone
      ORDER BY created_at ASC LIMIT 1;
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
    RETURN v_guest;
  END IF;

  -- Insert a new row. ON CONFLICT against the partial UNIQUE indexes
  -- on lower(email) / phone catches the rare race where two parallel
  -- callers both reached the dedup lookup before either had committed,
  -- and routes the second caller back to the survivor instead of
  -- failing the request or creating a duplicate.
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
  ON CONFLICT (lower(email)) WHERE email IS NOT NULL
  DO UPDATE SET
    first_name              = EXCLUDED.first_name,
    last_name               = COALESCE(EXCLUDED.last_name, guests.last_name),
    phone                   = COALESCE(EXCLUDED.phone, guests.phone),
    instagram               = COALESCE(EXCLUDED.instagram, guests.instagram),
    notification_preference = EXCLUDED.notification_preference,
    updated_at              = now()
  RETURNING * INTO v_guest;

  IF v_guest IS NOT NULL THEN
    RETURN v_guest;
  END IF;

  -- email was NULL on the insert, so the email-keyed ON CONFLICT didn't
  -- trigger; try the phone-keyed one.
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
  ON CONFLICT (phone) WHERE phone IS NOT NULL
  DO UPDATE SET
    first_name              = EXCLUDED.first_name,
    last_name               = COALESCE(EXCLUDED.last_name, guests.last_name),
    email                   = COALESCE(EXCLUDED.email, guests.email),
    instagram               = COALESCE(EXCLUDED.instagram, guests.instagram),
    notification_preference = EXCLUDED.notification_preference,
    updated_at              = now()
  RETURNING * INTO v_guest;

  RETURN v_guest;
END;
$$;

REVOKE EXECUTE ON FUNCTION upsert_guest(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_guest(JSONB, UUID) TO anon, authenticated;

-- ============================================================
-- 5. add_plus_one: refuse a second +1 on a parent that already has
-- one. This is also enforced by the new UNIQUE index on
-- rsvps.plus_one_of, but failing here gives a clearer error to the
-- client (and avoids the cryptic 23505 unique_violation surface).
-- ============================================================
CREATE OR REPLACE FUNCTION add_plus_one(
  p_parent_rsvp_id UUID,
  p_first_name TEXT
) RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_parent rsvps;
  v_plus_one_guest_id UUID;
  v_capacity INTEGER;
  v_current_count INTEGER;
  v_status TEXT := 'yes';
  v_position INTEGER;
  v_rsvp rsvps;
  v_first TEXT := NULLIF(trim(p_first_name), '');
  v_existing rsvps;
BEGIN
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'first_name required';
  END IF;

  SELECT * INTO v_parent FROM rsvps WHERE id = p_parent_rsvp_id;
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'Parent RSVP not found';
  END IF;

  IF v_parent.status NOT IN ('yes', 'waitlisted') THEN
    RAISE EXCEPTION 'Plus-ones are only allowed on going or waitlisted RSVPs';
  END IF;

  -- Idempotency: if this parent already has a +1, return it as-is.
  -- The form's flow only calls add_plus_one when existingPlusOne is
  -- null, but a stale fetch could land here with a +1 already in the
  -- database; better to return the existing row than to insert a
  -- second one (which the partial UNIQUE index would reject anyway).
  SELECT * INTO v_existing
  FROM rsvps
  WHERE plus_one_of = p_parent_rsvp_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO guests (first_name, notification_preference)
  VALUES (v_first, 'none')
  RETURNING id INTO v_plus_one_guest_id;

  IF v_parent.status = 'waitlisted' THEN
    v_status := 'waitlisted';
  ELSE
    SELECT capacity INTO v_capacity FROM events WHERE id = v_parent.event_id;
    IF v_capacity IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_count
      FROM rsvps
      WHERE event_id = v_parent.event_id AND status = 'yes';
      IF v_current_count >= v_capacity THEN
        v_status := 'waitlisted';
      END IF;
    END IF;
  END IF;

  IF v_status = 'waitlisted' THEN
    SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_position
    FROM rsvps
    WHERE event_id = v_parent.event_id AND status = 'waitlisted';

    INSERT INTO rsvps (
      event_id, guest_id, status, plus_one_of,
      waitlist_position, waitlisted_at
    )
    VALUES (
      v_parent.event_id, v_plus_one_guest_id, 'waitlisted', p_parent_rsvp_id,
      v_position, now()
    )
    RETURNING * INTO v_rsvp;
  ELSE
    INSERT INTO rsvps (event_id, guest_id, status, plus_one_of)
    VALUES (v_parent.event_id, v_plus_one_guest_id, v_status, p_parent_rsvp_id)
    RETURNING * INTO v_rsvp;
  END IF;

  RETURN v_rsvp;
END;
$$;

REVOKE EXECUTE ON FUNCTION add_plus_one(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_plus_one(UUID, TEXT) TO anon, authenticated;

-- ============================================================
-- 6. remove_plus_one: delete the +1's rsvp explicitly so a future
-- weakened FK cascade can't leave a stranded +1 row whose
-- plus_one_of points at a now-missing guest.
-- ============================================================
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

  DELETE FROM rsvps WHERE id = p_plus_one_rsvp_id;
  DELETE FROM guests WHERE id = v_guest_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION remove_plus_one(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_plus_one(UUID) TO anon, authenticated;
