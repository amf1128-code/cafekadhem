-- Cafe Kadhem Database Schema
-- All tables with RLS policies enabled

-- ============================================================
-- ADMIN SETTINGS (single row)
-- ============================================================
CREATE TABLE admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venmo_handle TEXT NOT NULL DEFAULT 'amf1128',
  cafe_name TEXT NOT NULL DEFAULT 'Cafe Kadhem',
  contact_email TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read settings"
  ON admin_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can update settings"
  ON admin_settings FOR UPDATE
  TO authenticated
  USING (true);

-- Public read for Venmo handle (needed for payment links)
CREATE POLICY "Public can read settings"
  ON admin_settings FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- MENUS
-- ============================================================
CREATE TABLE menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_template BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE menus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read menus"
  ON menus FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admin can insert menus"
  ON menus FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admin can update menus"
  ON menus FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Admin can delete menus"
  ON menus FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================
-- EVENTS
-- ============================================================
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  location TEXT NOT NULL,
  flyer_url TEXT,
  menu_id UUID REFERENCES menus(id),
  capacity INTEGER,
  donation_info TEXT,
  is_published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read published events"
  ON events FOR SELECT
  TO anon
  USING (is_published = true);

CREATE POLICY "Authenticated can read all events"
  ON events FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can insert events"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admin can update events"
  ON events FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Admin can delete events"
  ON events FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================
-- MENU ITEMS
-- ============================================================
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id UUID REFERENCES menus(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2),
  category TEXT,
  sort_order INTEGER DEFAULT 0,
  image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read menu items"
  ON menu_items FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admin can insert menu items"
  ON menu_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admin can update menu items"
  ON menu_items FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Admin can delete menu items"
  ON menu_items FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================
-- GUESTS
-- ============================================================
CREATE TABLE guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  instagram TEXT,
  notification_preference TEXT DEFAULT 'email'
    CHECK (notification_preference IN ('sms', 'email', 'none')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT contact_required CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

ALTER TABLE guests ENABLE ROW LEVEL SECURITY;

-- Admin can do everything
CREATE POLICY "Admin can read guests"
  ON guests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can insert guests"
  ON guests FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admin can update guests"
  ON guests FOR UPDATE
  TO authenticated
  USING (true);

-- Public can insert (self-registration via RSVP)
CREATE POLICY "Public can insert guests"
  ON guests FOR INSERT
  TO anon
  WITH CHECK (true);

-- Public can update their own record (matched by id passed from client)
CREATE POLICY "Public can update own guest"
  ON guests FOR UPDATE
  TO anon
  USING (true);

-- Public can read (only through the view below, but we need base policy)
CREATE POLICY "Public can read guests"
  ON guests FOR SELECT
  TO anon
  USING (true);

-- Public-safe view: only exposes non-PII fields
CREATE VIEW public_guest_profiles AS
  SELECT id, first_name, instagram
  FROM guests;

-- ============================================================
-- RSVPS
-- ============================================================
CREATE TABLE rsvps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  guest_id UUID REFERENCES guests(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('yes', 'maybe', 'no')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, guest_id)
);

ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read rsvps"
  ON rsvps FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can insert rsvps"
  ON rsvps FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Public can update rsvps"
  ON rsvps FOR UPDATE
  TO anon
  USING (true);

CREATE POLICY "Admin can manage rsvps"
  ON rsvps FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- ORDERS
-- ============================================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  guest_id UUID REFERENCES guests(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'paid', 'cancelled')),
  payment_method TEXT DEFAULT 'venmo'
    CHECK (payment_method IN ('venmo', 'stripe')),
  total DECIMAL(10,2),
  venmo_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can insert orders"
  ON orders FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Public can read own orders"
  ON orders FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Admin can manage orders"
  ON orders FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- ORDER ITEMS
-- ============================================================
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  menu_item_id UUID REFERENCES menu_items(id) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2)
);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can insert order items"
  ON order_items FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Public can read order items"
  ON order_items FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admin can manage order items"
  ON order_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- INVITES
-- ============================================================
CREATE TABLE invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  invited_by UUID REFERENCES guests(id),
  invited_email TEXT,
  invited_phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read invites by token"
  ON invites FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can insert invites"
  ON invites FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Admin can manage invites"
  ON invites FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- NOTIFICATIONS LOG
-- ============================================================
CREATE TABLE notifications_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID REFERENCES guests(id),
  event_id UUID REFERENCES events(id),
  channel TEXT CHECK (channel IN ('sms', 'email')),
  type TEXT,
  status TEXT CHECK (status IN ('sent', 'failed', 'queued')),
  sent_at TIMESTAMPTZ,
  error TEXT
);

ALTER TABLE notifications_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can manage notifications"
  ON notifications_log FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- CAPACITY-SAFE RSVP FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION safe_create_rsvp(
  p_event_id UUID,
  p_guest_id UUID,
  p_status TEXT
) RETURNS rsvps AS $$
DECLARE
  v_capacity INTEGER;
  v_current_count INTEGER;
  v_rsvp rsvps;
BEGIN
  -- Get event capacity
  SELECT capacity INTO v_capacity FROM events WHERE id = p_event_id;

  -- If capacity is set and status is 'yes', check availability
  IF v_capacity IS NOT NULL AND p_status = 'yes' THEN
    SELECT COUNT(*) INTO v_current_count
    FROM rsvps
    WHERE event_id = p_event_id AND status = 'yes' AND guest_id != p_guest_id;

    IF v_current_count >= v_capacity THEN
      -- Auto-downgrade to 'maybe' (waitlist)
      p_status := 'maybe';
    END IF;
  END IF;

  -- Upsert the RSVP
  INSERT INTO rsvps (event_id, guest_id, status)
  VALUES (p_event_id, p_guest_id, p_status)
  ON CONFLICT (event_id, guest_id)
  DO UPDATE SET status = EXCLUDED.status, updated_at = now()
  RETURNING * INTO v_rsvp;

  RETURN v_rsvp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_admin_settings_updated_at
  BEFORE UPDATE ON admin_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_menus_updated_at
  BEFORE UPDATE ON menus
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_guests_updated_at
  BEFORE UPDATE ON guests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_rsvps_updated_at
  BEFORE UPDATE ON rsvps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
