-- ============================================================
-- 035: Hot-fix migration 029 — events column is `is_published`
-- (BOOLEAN), not `status`. Replaces the get_guest_event_state body.
--
-- Identical to 029 except the SELECT and the closed-event check.
-- ============================================================

CREATE OR REPLACE FUNCTION get_guest_event_state(
  p_event_id UUID,
  p_guest_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event           RECORD;
  v_rsvp            RECORD;
  v_plus_one_name   TEXT;
  v_order_total     NUMERIC;
  v_yes_count       INTEGER;
  v_capacity_remain INTEGER;
  v_next_step       TEXT;
BEGIN
  SELECT id, is_published, capacity, ticketing_enabled, ticket_price, rsvp_required
    INTO v_event
    FROM events
   WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'event_not_found');
  END IF;

  IF v_event.capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO v_yes_count
      FROM rsvps
     WHERE event_id = p_event_id AND status = 'yes';
    v_capacity_remain := GREATEST(v_event.capacity - v_yes_count, 0);
  ELSE
    v_capacity_remain := NULL;
  END IF;

  SELECT id, status, waitlist_position, payment_status, ticket_token,
         checked_in_at
    INTO v_rsvp
    FROM rsvps
   WHERE event_id = p_event_id
     AND guest_id = p_guest_id
     AND plus_one_of IS NULL;

  IF v_rsvp.id IS NOT NULL THEN
    SELECT g.first_name
      INTO v_plus_one_name
      FROM rsvps p
      JOIN guests g ON g.id = p.guest_id
     WHERE p.plus_one_of = v_rsvp.id
     LIMIT 1;
  END IF;

  SELECT SUM(total) INTO v_order_total
    FROM orders
   WHERE event_id = p_event_id AND guest_id = p_guest_id;

  IF NOT v_event.is_published THEN
    v_next_step := 'closed';
  ELSIF v_rsvp.status IS NULL THEN
    IF v_event.rsvp_required THEN
      v_next_step := 'rsvp';
    ELSIF v_order_total IS NOT NULL THEN
      v_next_step := 'view_order';
    ELSE
      v_next_step := 'rsvp';
    END IF;
  ELSIF v_rsvp.status = 'yes' AND v_event.ticketing_enabled THEN
    IF v_rsvp.payment_status IN ('unpaid', 'pending') THEN
      v_next_step := 'pay';
    ELSIF v_rsvp.payment_status = 'paid' THEN
      v_next_step := 'view_ticket';
    ELSE
      v_next_step := 'edit_rsvp';
    END IF;
  ELSE
    v_next_step := 'edit_rsvp';
  END IF;

  RETURN jsonb_build_object(
    'rsvp',                v_rsvp.status,
    'waitlist_position',   v_rsvp.waitlist_position,
    'plus_one',            CASE WHEN v_plus_one_name IS NOT NULL
                                THEN jsonb_build_object('name', v_plus_one_name)
                                ELSE NULL END,
    'is_ticketed_event',   v_event.ticketing_enabled,
    'payment_status',      v_rsvp.payment_status,
    'ticket_token',        v_rsvp.ticket_token,
    'checked_in_at',       v_rsvp.checked_in_at,
    'has_food_order',      (v_order_total IS NOT NULL),
    'food_order_total',    v_order_total,
    'capacity_remaining',  v_capacity_remain,
    'invited_by',          NULL,
    'next_step',           v_next_step
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_guest_event_state(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_guest_event_state(UUID, UUID) TO anon, authenticated;
