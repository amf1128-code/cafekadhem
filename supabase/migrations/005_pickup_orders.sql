-- Pickup order system: config for available days/times, and pickup-specific orders

-- Pickup configuration: available pickup slots and active menu
create table pickup_config (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid references menus(id) on delete set null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Available pickup days and time slots
create table pickup_slots (
  id uuid primary key default gen_random_uuid(),
  pickup_config_id uuid not null references pickup_config(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0=Sunday
  start_time time not null,
  end_time time not null,
  max_orders integer, -- optional cap per slot
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Pickup orders (separate from event orders)
create table pickup_orders (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references guests(id) on delete cascade,
  menu_id uuid not null references menus(id) on delete restrict,
  pickup_date date not null,
  pickup_time time not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'paid', 'picked_up', 'cancelled')),
  payment_method text not null default 'venmo' check (payment_method in ('venmo', 'stripe')),
  total numeric(10,2),
  venmo_note text,
  notes text, -- customer notes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pickup order line items
create table pickup_order_items (
  id uuid primary key default gen_random_uuid(),
  pickup_order_id uuid not null references pickup_orders(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(10,2)
);

-- Triggers for updated_at
create trigger set_pickup_config_updated_at
  before update on pickup_config
  for each row execute function update_updated_at();

create trigger set_pickup_orders_updated_at
  before update on pickup_orders
  for each row execute function update_updated_at();

-- RLS policies
alter table pickup_config enable row level security;
alter table pickup_slots enable row level security;
alter table pickup_orders enable row level security;
alter table pickup_order_items enable row level security;

-- pickup_config: public read, admin manage
create policy "Public can read active pickup config"
  on pickup_config for select using (true);

create policy "Admin can manage pickup config"
  on pickup_config for all
  using (auth.role() = 'authenticated');

-- pickup_slots: public read, admin manage
create policy "Public can read pickup slots"
  on pickup_slots for select using (true);

create policy "Admin can manage pickup slots"
  on pickup_slots for all
  using (auth.role() = 'authenticated');

-- pickup_orders: public can create and read own, admin manage all
create policy "Public can create pickup orders"
  on pickup_orders for insert with check (true);

create policy "Public can read own pickup orders"
  on pickup_orders for select using (true);

create policy "Admin can manage pickup orders"
  on pickup_orders for all
  using (auth.role() = 'authenticated');

-- pickup_order_items: public can create and read, admin manage
create policy "Public can create pickup order items"
  on pickup_order_items for insert with check (true);

create policy "Public can read pickup order items"
  on pickup_order_items for select using (true);

create policy "Admin can manage pickup order items"
  on pickup_order_items for all
  using (auth.role() = 'authenticated');
