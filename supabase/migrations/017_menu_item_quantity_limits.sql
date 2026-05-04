-- Optional per-piece quantity caps on menu items, scoped to a pickup
-- "session": one event for event pre-orders, the active pickup_config for
-- pickup-day orders. Limits are stored separately so the same menu reused on
-- a different event/session starts with a clean slate.
--
-- Also adds an internal-only unit_cost on menu_items (admin accounting), and
-- snapshots that cost onto order line items so historical margin reports are
-- stable across price/cost edits.

-- ============================================================
-- INTERNAL UNIT COST (admin-only)
-- ============================================================
ALTER TABLE menu_items ADD COLUMN unit_cost NUMERIC(10,2);
ALTER TABLE order_items ADD COLUMN unit_cost NUMERIC(10,2);
ALTER TABLE pickup_order_items ADD COLUMN unit_cost NUMERIC(10,2);

-- The existing menu_items public read policy exposes every column. Replace
-- it with a column-stripping public view, and lock the base table down to
-- authenticated reads only so unit_cost never leaks to anon clients.
DROP POLICY "Public can read menu items" ON menu_items;

CREATE POLICY "Authenticated can read menu items"
  ON menu_items FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE VIEW public_menu_items AS
  SELECT id, menu_id, name, description, price, category, sort_order,
         image_url, is_available, created_at
  FROM menu_items;

GRANT SELECT ON public_menu_items TO anon, authenticated;

-- ============================================================
-- EVENT-SCOPED LIMITS
-- ============================================================
CREATE TABLE event_menu_item_limits (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  max_quantity INTEGER NOT NULL CHECK (max_quantity >= 0),
  PRIMARY KEY (event_id, menu_item_id)
);

ALTER TABLE event_menu_item_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read event menu item limits"
  ON event_menu_item_limits FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admin can manage event menu item limits"
  ON event_menu_item_limits FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- PICKUP-SCOPED LIMITS
-- ============================================================
CREATE TABLE pickup_menu_item_limits (
  pickup_config_id UUID NOT NULL REFERENCES pickup_config(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  max_quantity INTEGER NOT NULL CHECK (max_quantity >= 0),
  PRIMARY KEY (pickup_config_id, menu_item_id)
);

ALTER TABLE pickup_menu_item_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read pickup menu item limits"
  ON pickup_menu_item_limits FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admin can manage pickup menu item limits"
  ON pickup_menu_item_limits FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- pickup_config is a singleton row whose menu_id can be swapped over time.
-- Track when the current "session" started so we don't carry forward sold
-- counts from a prior round on the same menu.
ALTER TABLE pickup_config
  ADD COLUMN limits_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION pickup_config_handle_menu_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.menu_id IS DISTINCT FROM OLD.menu_id THEN
    DELETE FROM pickup_menu_item_limits WHERE pickup_config_id = NEW.id;
    NEW.limits_reset_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pickup_config_menu_change_trigger
  BEFORE UPDATE ON pickup_config
  FOR EACH ROW EXECUTE FUNCTION pickup_config_handle_menu_change();

-- ============================================================
-- AVAILABILITY (max + sold) PER ITEM
-- "Sold" counts every line on a non-cancelled order, so a guest who has
-- claimed an item but not yet paid still holds inventory.
-- ============================================================
CREATE OR REPLACE FUNCTION event_menu_item_availability(p_event_id UUID)
RETURNS TABLE (
  menu_item_id UUID,
  max_quantity INTEGER,
  sold_quantity INTEGER
) AS $$
  SELECT
    l.menu_item_id,
    l.max_quantity,
    COALESCE((
      SELECT SUM(oi.quantity)::INTEGER
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.event_id = p_event_id
        AND oi.menu_item_id = l.menu_item_id
        AND o.status <> 'cancelled'
    ), 0) AS sold_quantity
  FROM event_menu_item_limits l
  WHERE l.event_id = p_event_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION pickup_menu_item_availability(p_pickup_config_id UUID)
RETURNS TABLE (
  menu_item_id UUID,
  max_quantity INTEGER,
  sold_quantity INTEGER
) AS $$
  SELECT
    l.menu_item_id,
    l.max_quantity,
    COALESCE((
      SELECT SUM(poi.quantity)::INTEGER
      FROM pickup_order_items poi
      JOIN pickup_orders po ON po.id = poi.pickup_order_id
      WHERE po.menu_id = pc.menu_id
        AND po.created_at >= pc.limits_reset_at
        AND poi.menu_item_id = l.menu_item_id
        AND po.status <> 'cancelled'
    ), 0) AS sold_quantity
  FROM pickup_menu_item_limits l
  JOIN pickup_config pc ON pc.id = l.pickup_config_id
  WHERE l.pickup_config_id = p_pickup_config_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- ATOMIC ORDER PLACEMENT — rejects if any line would exceed its cap
-- ============================================================
CREATE OR REPLACE FUNCTION safe_create_order(
  p_event_id UUID,
  p_guest_id UUID,
  p_total NUMERIC,
  p_venmo_note TEXT,
  p_payment_method TEXT,
  p_items JSONB
) RETURNS orders AS $$
DECLARE
  v_order orders;
  v_item RECORD;
  v_max INTEGER;
  v_sold INTEGER;
  v_item_name TEXT;
BEGIN
  -- Serialize concurrent placement on the same event
  PERFORM 1 FROM events WHERE id = p_event_id FOR UPDATE;

  FOR v_item IN
    SELECT
      (elem->>'menu_item_id')::UUID AS menu_item_id,
      (elem->>'quantity')::INTEGER AS quantity,
      (elem->>'unit_price')::NUMERIC AS unit_price
    FROM jsonb_array_elements(p_items) AS elem
  LOOP
    SELECT max_quantity INTO v_max
      FROM event_menu_item_limits
      WHERE event_id = p_event_id AND menu_item_id = v_item.menu_item_id;

    IF v_max IS NOT NULL THEN
      SELECT COALESCE(SUM(oi.quantity), 0) INTO v_sold
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.event_id = p_event_id
          AND oi.menu_item_id = v_item.menu_item_id
          AND o.status <> 'cancelled';

      IF v_sold + v_item.quantity > v_max THEN
        SELECT name INTO v_item_name FROM menu_items WHERE id = v_item.menu_item_id;
        RAISE EXCEPTION 'OUT_OF_STOCK: % only has % left',
          COALESCE(v_item_name, 'item'),
          GREATEST(v_max - v_sold, 0)
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END LOOP;

  INSERT INTO orders (event_id, guest_id, total, venmo_note, status, payment_method)
  VALUES (p_event_id, p_guest_id, p_total, p_venmo_note, 'pending', COALESCE(p_payment_method, 'venmo'))
  RETURNING * INTO v_order;

  INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, unit_cost)
  SELECT v_order.id,
         (elem->>'menu_item_id')::UUID,
         (elem->>'quantity')::INTEGER,
         (elem->>'unit_price')::NUMERIC,
         mi.unit_cost
    FROM jsonb_array_elements(p_items) AS elem
    LEFT JOIN menu_items mi ON mi.id = (elem->>'menu_item_id')::UUID;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION safe_create_pickup_order(
  p_guest_id UUID,
  p_menu_id UUID,
  p_pickup_date DATE,
  p_pickup_time TIME,
  p_total NUMERIC,
  p_venmo_note TEXT,
  p_notes TEXT,
  p_payment_method TEXT,
  p_items JSONB
) RETURNS pickup_orders AS $$
DECLARE
  v_order pickup_orders;
  v_item RECORD;
  v_max INTEGER;
  v_sold INTEGER;
  v_item_name TEXT;
  v_config pickup_config;
BEGIN
  -- Find the active config for this menu and lock it for serialization
  SELECT * INTO v_config
    FROM pickup_config
    WHERE menu_id = p_menu_id AND is_active = true
    FOR UPDATE
    LIMIT 1;

  IF v_config.id IS NOT NULL THEN
    FOR v_item IN
      SELECT
        (elem->>'menu_item_id')::UUID AS menu_item_id,
        (elem->>'quantity')::INTEGER AS quantity,
        (elem->>'unit_price')::NUMERIC AS unit_price
      FROM jsonb_array_elements(p_items) AS elem
    LOOP
      SELECT max_quantity INTO v_max
        FROM pickup_menu_item_limits
        WHERE pickup_config_id = v_config.id
          AND menu_item_id = v_item.menu_item_id;

      IF v_max IS NOT NULL THEN
        SELECT COALESCE(SUM(poi.quantity), 0) INTO v_sold
          FROM pickup_order_items poi
          JOIN pickup_orders po ON po.id = poi.pickup_order_id
          WHERE po.menu_id = v_config.menu_id
            AND po.created_at >= v_config.limits_reset_at
            AND poi.menu_item_id = v_item.menu_item_id
            AND po.status <> 'cancelled';

        IF v_sold + v_item.quantity > v_max THEN
          SELECT name INTO v_item_name FROM menu_items WHERE id = v_item.menu_item_id;
          RAISE EXCEPTION 'OUT_OF_STOCK: % only has % left',
            COALESCE(v_item_name, 'item'),
            GREATEST(v_max - v_sold, 0)
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO pickup_orders (
    guest_id, menu_id, pickup_date, pickup_time, total, venmo_note, notes, status, payment_method
  )
  VALUES (
    p_guest_id, p_menu_id, p_pickup_date, p_pickup_time, p_total, p_venmo_note, p_notes,
    'pending', COALESCE(p_payment_method, 'venmo')
  )
  RETURNING * INTO v_order;

  INSERT INTO pickup_order_items (pickup_order_id, menu_item_id, quantity, unit_price, unit_cost)
  SELECT v_order.id,
         (elem->>'menu_item_id')::UUID,
         (elem->>'quantity')::INTEGER,
         (elem->>'unit_price')::NUMERIC,
         mi.unit_cost
    FROM jsonb_array_elements(p_items) AS elem
    LEFT JOIN menu_items mi ON mi.id = (elem->>'menu_item_id')::UUID;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION event_menu_item_availability(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION pickup_menu_item_availability(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION safe_create_order(UUID, UUID, NUMERIC, TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION safe_create_pickup_order(UUID, UUID, DATE, TIME, NUMERIC, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
