-- ============================================================
-- 065: Door bypass-waitlist QR flow.
--
-- A host shows a per-event QR at the door. Scanning opens a stripped-down,
-- capacity-bypassing register+pay page so anyone physically present — a
-- waitlisted guest or a total walk-up — can grab a spot and pay, without
-- the sold-out / waitlist gate that blocks the normal public flow.
--
-- Gating: an unguessable per-event token (events.door_token) carried in the
-- QR link. It's rotatable (re-mint to kill a leaked code). The register /
-- attest RPCs require a valid token, so the bypass can't be used remotely
-- to jump the line from home.
--
-- Verification model = "provisional, reconcile later": the door creates a
-- walk-in 'yes' row (counted; capacity is intentionally bypassed — they're
-- standing right there), and the guest self-attests payment_status='pending'
-- ("said they paid"). The host reconciles against Venmo on the existing
-- check-in console and confirms / checks them in there.
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS door_token TEXT UNIQUE;

COMMENT ON COLUMN events.door_token IS
  'Unguessable per-event token embedded in the door QR. Rotatable via mint_door_token; gates the capacity-bypassing door register/attest RPCs.';

-- ------------------------------------------------------------
-- mint_door_token: create or rotate the door token (admin). Re-minting
-- invalidates any previously-shared QR.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mint_door_token(p_event_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token TEXT;
BEGIN
  UPDATE events
  SET door_token = encode(gen_random_bytes(16), 'hex'),
      updated_at = now()
  WHERE id = p_event_id
  RETURNING door_token INTO v_token;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;
  RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION mint_door_token(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mint_door_token(UUID) TO authenticated;

-- ------------------------------------------------------------
-- resolve_door_token: token -> the bits the door page needs to render.
-- Public (anon) — the token is the credential. Returns {ok:false} for a
-- bad/rotated token so the page can show a friendly "ask staff" state.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_door_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v JSON;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN json_build_object('ok', false);
  END IF;

  SELECT json_build_object(
    'ok', true,
    'event_id', id,
    'title', title,
    'ticket_price', ticket_price,
    'ticketing_enabled', ticketing_enabled
  ) INTO v
  FROM events
  WHERE door_token = p_token;

  RETURN COALESCE(v, json_build_object('ok', false));
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_door_token(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- door_register: token-gated walk-in registration. Dedups the guest by
-- email then phone (collapsing a waitlisted guest onto their existing row
-- and flipping them off the waitlist), creates/updates a walk-in 'yes'
-- RSVP, and BYPASSES capacity by design. Never downgrades a paid row.
-- Returns the rsvp id + whether they're already paid.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION door_register(
  p_token      TEXT,
  p_first_name TEXT,
  p_last_name  TEXT DEFAULT NULL,
  p_email      TEXT DEFAULT NULL,
  p_phone      TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
  v_first    TEXT := NULLIF(trim(p_first_name), '');
  v_last     TEXT := NULLIF(trim(p_last_name), '');
  v_email    TEXT := NULLIF(trim(p_email), '');
  v_phone    TEXT := NULLIF(trim(p_phone), '');
  v_guest_id UUID;
  v_rsvp     rsvps;
BEGIN
  SELECT id INTO v_event_id FROM events WHERE door_token = p_token;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_door_token';
  END IF;
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'first_name required';
  END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'email or phone required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || v_event_id::text));

  -- Dedup against an existing guest by email, then phone.
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_guest_id FROM guests
      WHERE lower(email) = lower(v_email) ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_guest_id IS NULL AND v_phone IS NOT NULL THEN
    SELECT id INTO v_guest_id FROM guests
      WHERE phone = v_phone ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_guest_id IS NULL THEN
    INSERT INTO guests (first_name, last_name, email, phone, notification_preference)
    VALUES (v_first, v_last, v_email, v_phone,
            CASE WHEN v_email IS NOT NULL OR v_phone IS NOT NULL THEN 'email' ELSE 'none' END)
    RETURNING id INTO v_guest_id;
  ELSE
    UPDATE guests SET
      last_name  = COALESCE(last_name, v_last),
      email      = COALESCE(email, v_email),
      phone      = COALESCE(phone, v_phone),
      updated_at = now()
    WHERE id = v_guest_id;
  END IF;

  INSERT INTO rsvps (event_id, guest_id, status, payment_status, walk_in)
  VALUES (v_event_id, v_guest_id, 'yes', 'unpaid', true)
  ON CONFLICT (event_id, guest_id) DO UPDATE SET
    -- Keep a paid attendee exactly as-is; otherwise admit them off the
    -- waitlist as a walk-in.
    status            = CASE WHEN rsvps.payment_status = 'paid' THEN rsvps.status ELSE 'yes' END,
    walk_in           = CASE WHEN rsvps.payment_status = 'paid' THEN rsvps.walk_in ELSE true END,
    waitlist_position = CASE WHEN rsvps.payment_status = 'paid' THEN rsvps.waitlist_position ELSE NULL END,
    waitlisted_at     = CASE WHEN rsvps.payment_status = 'paid' THEN rsvps.waitlisted_at ELSE NULL END,
    promoted_at       = NULL,
    updated_at        = now()
  RETURNING * INTO v_rsvp;

  RETURN json_build_object(
    'ok', true,
    'rsvp_id', v_rsvp.id,
    'guest_id', v_rsvp.guest_id,
    'payment_status', v_rsvp.payment_status,
    'already_paid', (v_rsvp.payment_status = 'paid'),
    'ticket_token', v_rsvp.ticket_token
  );
END;
$$;

GRANT EXECUTE ON FUNCTION door_register(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- door_attest_paid: guest taps "I've paid" at the door. Flips an unpaid
-- walk-in to payment_status='pending' ("said they paid") so the host sees
-- them flagged for reconciliation. Token-gated; no-op if already paid.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION door_attest_paid(p_token TEXT, p_rsvp_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
  v_rsvp     rsvps;
BEGIN
  SELECT id INTO v_event_id FROM events WHERE door_token = p_token;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_door_token';
  END IF;

  UPDATE rsvps
  SET payment_status = 'pending', updated_at = now()
  WHERE id = p_rsvp_id
    AND event_id = v_event_id
    AND payment_status = 'unpaid'
  RETURNING * INTO v_rsvp;

  -- Already paid/pending, or wrong event: report current state, don't error.
  IF v_rsvp IS NULL THEN
    SELECT * INTO v_rsvp FROM rsvps WHERE id = p_rsvp_id AND event_id = v_event_id;
    IF v_rsvp IS NULL THEN
      RAISE EXCEPTION 'RSVP not found';
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'payment_status', v_rsvp.payment_status);
END;
$$;

GRANT EXECUTE ON FUNCTION door_attest_paid(TEXT, UUID) TO anon, authenticated;
