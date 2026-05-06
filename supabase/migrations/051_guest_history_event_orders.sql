-- ============================================================
-- get_guest_history: also return event-tied pre-orders so the
-- /my-tickets page can show "what I pre-ordered" alongside the
-- RSVP for each event. RSVPs and pickup orders already shipped
-- in 013_magic_links.sql; this layers `event_orders` on top.
-- ============================================================
CREATE OR REPLACE FUNCTION get_guest_history(p_guest_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_guest guests;
  v_rsvps JSON;
  v_pickups JSON;
  v_event_orders JSON;
BEGIN
  SELECT * INTO v_guest FROM guests WHERE id = p_guest_id;
  IF v_guest IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.event_date DESC), '[]'::json)
  INTO v_rsvps
  FROM (
    SELECT
      rsvps.id            AS rsvp_id,
      rsvps.status,
      rsvps.payment_status,
      rsvps.ticket_token,
      rsvps.checked_in_at,
      rsvps.created_at    AS rsvp_created_at,
      events.id           AS event_id,
      events.title        AS event_title,
      events.date         AS event_date,
      events.start_time   AS event_start_time,
      events.end_time     AS event_end_time,
      events.location     AS event_location,
      events.location_name AS event_location_name,
      events.flyer_url    AS event_flyer_url,
      events.ticketing_enabled,
      events.ticket_price,
      events.is_published
    FROM rsvps
    JOIN events ON events.id = rsvps.event_id
    WHERE rsvps.guest_id = p_guest_id
  ) r;

  SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.pickup_date DESC), '[]'::json)
  INTO v_pickups
  FROM (
    SELECT
      pickup_orders.id,
      pickup_orders.pickup_date,
      pickup_orders.pickup_time,
      pickup_orders.status,
      pickup_orders.total,
      pickup_orders.created_at
    FROM pickup_orders
    WHERE guest_id = p_guest_id
  ) p;

  SELECT COALESCE(json_agg(row_to_json(o) ORDER BY o.event_date DESC, o.created_at DESC), '[]'::json)
  INTO v_event_orders
  FROM (
    SELECT
      orders.id           AS order_id,
      orders.event_id,
      orders.status,
      orders.total,
      orders.venmo_note,
      orders.created_at,
      events.title        AS event_title,
      events.date         AS event_date,
      events.start_time   AS event_start_time,
      events.location_name AS event_location_name,
      events.is_published,
      (
        SELECT COALESCE(json_agg(json_build_object(
          'id',         oi.id,
          'name',       mi.name,
          'quantity',   oi.quantity,
          'unit_price', oi.unit_price
        ) ORDER BY mi.name), '[]'::json)
        FROM order_items oi
        LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
        WHERE oi.order_id = orders.id
      ) AS items
    FROM orders
    JOIN events ON events.id = orders.event_id
    WHERE orders.guest_id = p_guest_id
  ) o;

  RETURN json_build_object(
    'guest_id',      v_guest.id,
    'first_name',    v_guest.first_name,
    'last_name',     v_guest.last_name,
    'rsvps',         v_rsvps,
    'pickups',       v_pickups,
    'event_orders',  v_event_orders
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_guest_history(UUID) TO anon, authenticated;
