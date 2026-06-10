-- ============================================================
-- 060: Door / check-in flow upgrades.
--
-- Powers a faster door experience (USER_FLOWS_SPEC §4.x):
--   1. Per-RSVP door notes ("actually paid for two") that surface when
--      the host scans or checks someone in.
--   2. A walk_in flag so manually-added attendees are visibly tagged.
--   3. A saved Venmo QR image on admin_settings for pay-at-the-door.
--   4. door_check_in: check anyone in by rsvp_id regardless of payment
--      (covers comps + just-paid walk-ins that have no token yet).
--   5. create_walk_in: issue a spot to someone who never registered —
--      name-only is allowed (the contact_required constraint was already
--      dropped in migration 023).
--   6. check_in_ticket now returns the note + payment_status so the
--      scanner screen can show "paid for two" etc.
-- ============================================================

-- 1. Per-RSVP door note + walk-in tag.
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS walk_in BOOLEAN NOT NULL DEFAULT false;

-- 2. Saved Venmo QR image (uploaded in /admin/settings). Null = fall back
--    to a generated QR of the Venmo profile at the door.
ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS venmo_qr_url TEXT;

-- ============================================================
-- check_in_ticket (REPLACES migration 010): same contract, now also
-- returns the door note + payment_status so the scanner can show them.
-- Still admin-only, still idempotent, still paid-tickets-only (a token
-- only exists once a payment was recorded).
-- ============================================================
CREATE OR REPLACE FUNCTION check_in_ticket(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp rsvps;
  v_guest guests;
  v_event events;
  v_was_already BOOLEAN;
  v_first_check_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_rsvp FROM rsvps WHERE ticket_token = p_token FOR UPDATE;
  IF v_rsvp IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invalid ticket');
  END IF;
  IF v_rsvp.payment_status <> 'paid' THEN
    RETURN json_build_object('success', false, 'error', 'Ticket is not paid');
  END IF;

  v_was_already := v_rsvp.checked_in_at IS NOT NULL;
  v_first_check_at := v_rsvp.checked_in_at;

  IF NOT v_was_already THEN
    UPDATE rsvps
    SET checked_in_at = now(), updated_at = now()
    WHERE id = v_rsvp.id
    RETURNING checked_in_at INTO v_first_check_at;
  END IF;

  SELECT * INTO v_guest FROM guests WHERE id = v_rsvp.guest_id;
  SELECT * INTO v_event FROM events WHERE id = v_rsvp.event_id;

  RETURN json_build_object(
    'success',             true,
    'already_checked_in',  v_was_already,
    'rsvp_id',             v_rsvp.id,
    'guest_first_name',    v_guest.first_name,
    'guest_last_name',     v_guest.last_name,
    'payment_status',      v_rsvp.payment_status,
    'notes',               v_rsvp.notes,
    'event_id',            v_event.id,
    'event_title',         v_event.title,
    'checked_in_at',       v_first_check_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION check_in_ticket(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION check_in_ticket(TEXT) TO authenticated;

-- ============================================================
-- door_check_in: check a guest in by rsvp_id, regardless of payment.
-- The row-button counterpart to the scanner. Used for:
--   - manual check-in of a paid guest who didn't pull up their QR
--   - comping in an unpaid guest at the host's discretion
--   - walk-ins (which may have no ticket_token)
-- Idempotent: re-running reports already_checked_in and keeps the
-- original timestamp. Admin-only.
-- ============================================================
CREATE OR REPLACE FUNCTION door_check_in(p_rsvp_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp rsvps;
  v_guest guests;
  v_was_already BOOLEAN;
  v_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_rsvp FROM rsvps WHERE id = p_rsvp_id FOR UPDATE;
  IF v_rsvp IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'RSVP not found');
  END IF;

  v_was_already := v_rsvp.checked_in_at IS NOT NULL;
  v_at := v_rsvp.checked_in_at;

  IF NOT v_was_already THEN
    UPDATE rsvps
    SET checked_in_at = now(), updated_at = now()
    WHERE id = v_rsvp.id
    RETURNING checked_in_at INTO v_at;
  END IF;

  SELECT * INTO v_guest FROM guests WHERE id = v_rsvp.guest_id;

  RETURN json_build_object(
    'success',            true,
    'already_checked_in', v_was_already,
    'rsvp_id',            v_rsvp.id,
    'guest_first_name',   v_guest.first_name,
    'guest_last_name',    v_guest.last_name,
    'payment_status',     v_rsvp.payment_status,
    'notes',              v_rsvp.notes,
    'checked_in_at',      v_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION door_check_in(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION door_check_in(UUID) TO authenticated;

-- ============================================================
-- create_walk_in: issue a spot to someone who never registered. Name is
-- the only requirement; email/phone are optional (the door often only
-- has a name). Dedups onto an existing guest when an email/phone matches,
-- and onto an existing RSVP for this event (so re-adding is a no-op
-- upsert rather than a duplicate). Optionally marks them paid and issues
-- a ticket token in the same step. Admin-only.
-- ============================================================
CREATE OR REPLACE FUNCTION create_walk_in(
  p_event_id   UUID,
  p_first_name TEXT,
  p_last_name  TEXT DEFAULT NULL,
  p_email      TEXT DEFAULT NULL,
  p_phone      TEXT DEFAULT NULL,
  p_notes      TEXT DEFAULT NULL,
  p_mark_paid  BOOLEAN DEFAULT false
) RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_first    TEXT := NULLIF(trim(p_first_name), '');
  v_last     TEXT := NULLIF(trim(p_last_name), '');
  v_email    TEXT := NULLIF(trim(p_email), '');
  v_phone    TEXT := NULLIF(trim(p_phone), '');
  v_notes    TEXT := NULLIF(trim(p_notes), '');
  v_guest_id UUID;
  v_token    TEXT;
  v_rsvp     rsvps;
BEGIN
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'first_name required';
  END IF;

  -- Dedup against an existing guest by email, then phone.
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_guest_id FROM guests
      WHERE lower(email) = lower(v_email)
      ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_guest_id IS NULL AND v_phone IS NOT NULL THEN
    SELECT id INTO v_guest_id FROM guests
      WHERE phone = v_phone
      ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_guest_id IS NULL THEN
    INSERT INTO guests (first_name, last_name, email, phone, notification_preference)
    VALUES (
      v_first, v_last, v_email, v_phone,
      CASE WHEN v_email IS NOT NULL OR v_phone IS NOT NULL THEN 'email' ELSE 'none' END
    )
    RETURNING id INTO v_guest_id;
  ELSE
    -- Backfill any newly-provided fields without clobbering existing ones.
    UPDATE guests SET
      last_name  = COALESCE(last_name, v_last),
      email      = COALESCE(email, v_email),
      phone      = COALESCE(phone, v_phone),
      updated_at = now()
    WHERE id = v_guest_id;
  END IF;

  v_token := CASE WHEN p_mark_paid THEN encode(gen_random_bytes(16), 'hex') ELSE NULL END;

  INSERT INTO rsvps (
    event_id, guest_id, status, payment_status, walk_in, notes, ticket_token, paid_at
  )
  VALUES (
    p_event_id, v_guest_id, 'yes',
    CASE WHEN p_mark_paid THEN 'paid' ELSE 'unpaid' END,
    true, v_notes, v_token,
    CASE WHEN p_mark_paid THEN now() ELSE NULL END
  )
  ON CONFLICT (event_id, guest_id) DO UPDATE SET
    status         = 'yes',
    walk_in        = true,
    notes          = COALESCE(EXCLUDED.notes, rsvps.notes),
    payment_status = CASE WHEN p_mark_paid THEN 'paid' ELSE rsvps.payment_status END,
    ticket_token   = CASE WHEN p_mark_paid
                          THEN COALESCE(rsvps.ticket_token, EXCLUDED.ticket_token)
                          ELSE rsvps.ticket_token END,
    paid_at        = CASE WHEN p_mark_paid
                          THEN COALESCE(rsvps.paid_at, now())
                          ELSE rsvps.paid_at END,
    updated_at     = now()
  RETURNING * INTO v_rsvp;

  RETURN v_rsvp;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_walk_in(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_walk_in(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
