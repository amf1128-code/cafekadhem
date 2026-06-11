-- ============================================================
-- 061: Enforce capacity on the new payment-gated RSVP flow.
--
-- Bug: on a ticketed/paid event (events.use_new_rsvp_flow = true) the
-- capacity cap was only ever checked inside safe_create_rsvp (the legacy
-- "free" flow). The paid flow promotes a registrant pending_payment -> yes
-- at the payment step (guest self-attest: mark_payment_pending; host
-- confirm: mark_rsvp_paid) and NEITHER consulted capacity — so a full
-- event kept accepting "going" registrants, violating spec invariant I1
-- (count(status='yes') <= capacity).
--
-- Fix: when the event is at capacity, route the registrant to the WAITLIST
-- instead of counting them. They keep status='waitlisted' with a position
-- and the host promotes them manually (promote_from_waitlist, mig 012,
-- which bumps capacity by 1 per click). A paid/pending registrant who
-- lands on the waitlist is a legitimate "paid waitlist" state — the
-- notification audiences already treat it as part of the going list
-- (USER_FLOWS_SPEC.md §8, event:rsvp_yes).
--
-- All three functions now take pg_advisory_xact_lock(hashtext('rsvp:'||
-- event_id)) — the SAME key safe_create_rsvp uses — so the capacity
-- check + write serialize against every other RSVP path on the event.
-- ============================================================

-- ------------------------------------------------------------
-- register_pending_payment: the new flow's first write ("Going").
-- Within capacity -> status 'pending_payment' (uncounted, will pay).
-- At capacity     -> status 'waitlisted' (no seat; the pay step is
--                    skipped and the guest is told they're on the list).
-- Never downgrades someone already going ('yes').
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_pending_payment(
  p_event_id UUID,
  p_guest_id UUID
)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp          rsvps;
  v_existing      rsvps;
  v_capacity      INTEGER;
  v_current_count INTEGER;
  v_next_position INTEGER;
  v_full          BOOLEAN := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || p_event_id::text));

  -- Already counted? Leave it untouched.
  SELECT * INTO v_existing
  FROM   rsvps
  WHERE  event_id = p_event_id
    AND  guest_id = p_guest_id
    AND  plus_one_of IS NULL;

  IF v_existing.status = 'yes' THEN
    RETURN v_existing;
  END IF;

  -- Capacity gate: if the room is full, switch this registration over to
  -- the waitlist rather than sending them into the pay flow.
  SELECT capacity INTO v_capacity FROM events WHERE id = p_event_id;
  IF v_capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current_count
    FROM   rsvps
    WHERE  event_id = p_event_id
      AND  status   = 'yes'
      AND  guest_id != p_guest_id;

    IF v_current_count >= v_capacity THEN
      v_full := true;
      SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_position
      FROM   rsvps
      WHERE  event_id = p_event_id AND status = 'waitlisted';
    END IF;
  END IF;

  IF v_full THEN
    INSERT INTO rsvps (event_id, guest_id, status, payment_status, waitlist_position, waitlisted_at)
    VALUES (p_event_id, p_guest_id, 'waitlisted', 'unpaid', v_next_position, now())
    ON CONFLICT (event_id, guest_id) DO UPDATE
      SET status            = CASE WHEN rsvps.status = 'yes' THEN 'yes' ELSE 'waitlisted' END,
          waitlist_position = COALESCE(rsvps.waitlist_position, EXCLUDED.waitlist_position),
          waitlisted_at     = COALESCE(rsvps.waitlisted_at, EXCLUDED.waitlisted_at),
          updated_at        = now()
    RETURNING * INTO v_rsvp;
  ELSE
    INSERT INTO rsvps (event_id, guest_id, status, payment_status)
    VALUES (p_event_id, p_guest_id, 'pending_payment', 'unpaid')
    ON CONFLICT (event_id, guest_id) DO UPDATE
      SET status     = CASE WHEN rsvps.status = 'yes' THEN 'yes' ELSE 'pending_payment' END,
          updated_at = now()
    RETURNING * INTO v_rsvp;
  END IF;

  RETURN v_rsvp;
END;
$$;

GRANT EXECUTE ON FUNCTION register_pending_payment(UUID, UUID) TO anon, authenticated;

-- ------------------------------------------------------------
-- mark_payment_pending: guest self-attests "I've paid". Promotes a
-- pending_payment registrant -> 'yes' ONLY if there's room; otherwise
-- holds them on the waitlist (payment_status='pending') for the host to
-- promote. A row that's already 'yes' or 'waitlisted' keeps its status.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_payment_pending(p_rsvp_id UUID)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp          rsvps;
  v_capacity      INTEGER;
  v_current_count INTEGER;
  v_next_position INTEGER;
  v_target_status TEXT;
BEGIN
  SELECT * INTO v_rsvp FROM rsvps WHERE id = p_rsvp_id;
  IF v_rsvp IS NULL OR v_rsvp.payment_status NOT IN ('unpaid', 'pending') THEN
    RAISE EXCEPTION 'RSVP not found or already finalized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || v_rsvp.event_id::text));

  v_target_status := v_rsvp.status;

  IF v_rsvp.status = 'pending_payment' THEN
    SELECT capacity INTO v_capacity FROM events WHERE id = v_rsvp.event_id;
    IF v_capacity IS NULL THEN
      v_target_status := 'yes';
    ELSE
      SELECT COUNT(*) INTO v_current_count
      FROM   rsvps
      WHERE  event_id = v_rsvp.event_id AND status = 'yes' AND id != p_rsvp_id;

      IF v_current_count >= v_capacity THEN
        v_target_status := 'waitlisted';
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_position
        FROM   rsvps
        WHERE  event_id = v_rsvp.event_id AND status = 'waitlisted';
      ELSE
        v_target_status := 'yes';
      END IF;
    END IF;
  END IF;

  UPDATE rsvps
  SET payment_status    = 'pending',
      status            = v_target_status,
      waitlist_position = CASE WHEN v_target_status = 'waitlisted'
                               THEN COALESCE(v_rsvp.waitlist_position, v_next_position)
                               ELSE NULL END,
      waitlisted_at     = CASE WHEN v_target_status = 'waitlisted'
                               THEN COALESCE(v_rsvp.waitlisted_at, now())
                               ELSE NULL END,
      updated_at        = now()
  WHERE id = p_rsvp_id
  RETURNING * INTO v_rsvp;

  RETURN v_rsvp;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_payment_pending(UUID) TO anon, authenticated;

-- ------------------------------------------------------------
-- mark_rsvp_paid: host confirms payment + issues a ticket. Promotes a
-- pending_payment registrant -> 'yes' only if there's room; on a full
-- event the (genuinely paid) guest is held on the waitlist so the host
-- makes the deliberate call to seat them via promote_from_waitlist
-- (which bumps capacity by 1). The ticket token is still issued so their
-- payment is on record. Idempotent (preserves token + paid_at).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_rsvp_paid(p_rsvp_id UUID)
RETURNS rsvps
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rsvp          rsvps;
  v_token         TEXT;
  v_capacity      INTEGER;
  v_current_count INTEGER;
  v_next_position INTEGER;
  v_target_status TEXT;
BEGIN
  SELECT * INTO v_rsvp FROM rsvps WHERE id = p_rsvp_id FOR UPDATE;
  IF v_rsvp IS NULL THEN
    RAISE EXCEPTION 'RSVP not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('rsvp:' || v_rsvp.event_id::text));

  v_token         := COALESCE(v_rsvp.ticket_token, encode(gen_random_bytes(16), 'hex'));
  v_target_status := v_rsvp.status;

  IF v_rsvp.status = 'pending_payment' THEN
    SELECT capacity INTO v_capacity FROM events WHERE id = v_rsvp.event_id;
    IF v_capacity IS NULL THEN
      v_target_status := 'yes';
    ELSE
      SELECT COUNT(*) INTO v_current_count
      FROM   rsvps
      WHERE  event_id = v_rsvp.event_id AND status = 'yes' AND id != p_rsvp_id;

      IF v_current_count >= v_capacity THEN
        v_target_status := 'waitlisted';
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_position
        FROM   rsvps
        WHERE  event_id = v_rsvp.event_id AND status = 'waitlisted';
      ELSE
        v_target_status := 'yes';
      END IF;
    END IF;
  END IF;

  UPDATE rsvps
  SET payment_status    = 'paid',
      status            = v_target_status,
      waitlist_position = CASE WHEN v_target_status = 'waitlisted'
                               THEN COALESCE(v_rsvp.waitlist_position, v_next_position)
                               ELSE NULL END,
      waitlisted_at     = CASE WHEN v_target_status = 'waitlisted'
                               THEN COALESCE(v_rsvp.waitlisted_at, now())
                               ELSE NULL END,
      paid_at           = COALESCE(rsvps.paid_at, now()),
      ticket_token      = v_token,
      updated_at        = now()
  WHERE id = p_rsvp_id
  RETURNING * INTO v_rsvp;

  RETURN v_rsvp;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_rsvp_paid(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_rsvp_paid(UUID) TO authenticated;
