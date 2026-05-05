-- ============================================================
-- Replacement RPCs for the broad anon SELECT/UPDATE policies on
-- guests / pickup_orders. This migration only ADDS the functions —
-- no policies are dropped here, so behavior of the running site is
-- unchanged. Client code will be migrated to call these in a follow-up,
-- and only after that's verified do we drop the broad policies.
--
-- Trust model is identical to today: holding the guest_id (or the
-- pickup_token) is what proves you may act on the row. SECURITY DEFINER
-- with explicit grants to anon makes the access path narrow and
-- auditable instead of "any anon SELECT * works."
-- ============================================================

-- ============================================================
-- get_my_guest(p_guest_id) — returns the full guest row by id.
-- Used by the "remember me" pre-fill on RSVP / Order / Pickup pages.
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_guest(p_guest_id UUID)
RETURNS guests
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_guest guests;
BEGIN
  IF p_guest_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_guest FROM guests WHERE id = p_guest_id;
  RETURN v_guest;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_my_guest(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_guest(UUID) TO anon, authenticated;

-- ============================================================
-- update_my_guest(p_guest_id, ...fields) — updates the editable
-- contact fields on a guest row by id. Only the fields the public
-- forms can change are accepted; id, created_at, updated_at are
-- never written from here. NULL params leave the existing value
-- alone (rather than nulling it out), matching how the client
-- forms behave today: they only send fields the user filled in.
-- ============================================================
CREATE OR REPLACE FUNCTION update_my_guest(
  p_guest_id UUID,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_instagram TEXT DEFAULT NULL,
  p_notification_preference TEXT DEFAULT NULL
) RETURNS guests
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_guest guests;
BEGIN
  IF p_guest_id IS NULL THEN
    RAISE EXCEPTION 'guest_id required';
  END IF;

  IF p_notification_preference IS NOT NULL
     AND p_notification_preference NOT IN ('sms', 'email', 'none') THEN
    RAISE EXCEPTION 'invalid notification_preference';
  END IF;

  UPDATE guests SET
    first_name              = COALESCE(p_first_name, first_name),
    last_name               = COALESCE(p_last_name, last_name),
    email                   = COALESCE(p_email, email),
    phone                   = COALESCE(p_phone, phone),
    instagram               = COALESCE(p_instagram, instagram),
    notification_preference = COALESCE(p_notification_preference, notification_preference),
    updated_at              = now()
  WHERE id = p_guest_id
  RETURNING * INTO v_guest;

  RETURN v_guest;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_my_guest(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_my_guest(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- get_pickup_order(p_token) — public lookup by pickup_token, mirroring
-- get_ticket(p_token). Returns the order plus its items joined to
-- menu_items, in a shape that matches the existing PostgREST
-- embedded-resource query the client uses today. Strips the internal
-- unit_cost column from both the line items and the menu items so it
-- can never leak through this path.
-- ============================================================
CREATE OR REPLACE FUNCTION get_pickup_order(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_order pickup_orders;
  v_items JSON;
BEGIN
  IF p_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order FROM pickup_orders WHERE pickup_token = p_token;
  IF v_order IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(json_agg(row_to_json(item) ORDER BY item.id), '[]'::json)
  INTO v_items
  FROM (
    SELECT
      poi.id,
      poi.pickup_order_id,
      poi.menu_item_id,
      poi.quantity,
      poi.unit_price,
      -- unit_cost intentionally omitted: admin-internal field.
      CASE
        WHEN mi.id IS NULL THEN NULL
        ELSE json_build_object(
          'id',           mi.id,
          'menu_id',      mi.menu_id,
          'name',         mi.name,
          'description',  mi.description,
          'price',        mi.price,
          'category',     mi.category,
          'sort_order',   mi.sort_order,
          'image_url',    mi.image_url,
          'is_available', mi.is_available,
          'created_at',   mi.created_at
        )
      END AS menu_item
    FROM pickup_order_items poi
    LEFT JOIN menu_items mi ON mi.id = poi.menu_item_id
    WHERE poi.pickup_order_id = v_order.id
  ) item;

  RETURN json_build_object(
    'id',             v_order.id,
    'guest_id',       v_order.guest_id,
    'menu_id',        v_order.menu_id,
    'pickup_date',    v_order.pickup_date,
    'pickup_time',    v_order.pickup_time,
    'status',         v_order.status,
    'payment_method', v_order.payment_method,
    'total',          v_order.total,
    'venmo_note',     v_order.venmo_note,
    'notes',          v_order.notes,
    'pickup_token',   v_order.pickup_token,
    'created_at',     v_order.created_at,
    'updated_at',     v_order.updated_at,
    'items',          v_items
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_pickup_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_pickup_order(UUID) TO anon, authenticated;
