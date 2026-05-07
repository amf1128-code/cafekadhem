export interface AdminSettings {
  id: string
  venmo_handle: string
  contact_email: string | null
  site_url: string
  theme: 'default' | 'theme1' | 'theme2' | 'theme3'
  // Master switch for outbound SMS. While off, every public form hides
  // the phone input and the "SMS" notification option, and lookup/invite
  // flows only accept email. Defaults to false until the operator's
  // 10DLC campaign is approved.
  sms_enabled: boolean
  // Italic blurb under "CURRENT MENU." on the cinema landing. Editable
  // from /admin/settings.
  current_menu_blurb: string | null
  updated_at: string
}

export interface Event {
  id: string
  title: string
  description: string | null
  date: string
  start_time: string
  end_time: string | null
  location: string
  location_name: string | null
  flyer_url: string | null
  home_flyer_url: string | null
  menu_id: string | null
  capacity: number | null
  donation_info: string | null
  gathering_number: string | null
  event_type: string | null
  rsvp_required: boolean
  is_published: boolean
  // When false, the event is "coming soon" — info is shown but the
  // public RSVP/ticketing CTAs are swapped for a "more details to
  // come" panel with a جاية tag. Defaults to true.
  is_rsvp_open: boolean
  ticketing_enabled: boolean
  ticket_price: number | null
  theme: 'theme1' | 'theme2' | 'theme3'
  // Cinema/poster landing fields. All optional; the cinema landing falls
  // back to defaults when null. Set per event from the admin form.
  display_arabic: string | null
  tagline: string | null
  highlights: string | null
  created_at: string
  updated_at: string
  // Joined fields
  menu?: Menu
  rsvp_count?: number
}

export interface Menu {
  id: string
  name: string
  description: string | null
  is_template: boolean
  created_at: string
  updated_at: string
  // Joined
  items?: MenuItem[]
}

export interface MenuItem {
  id: string
  menu_id: string
  name: string
  description: string | null
  price: number | null
  // Internal-only cost basis used for margin reporting; never returned to
  // the public menu view. Will be undefined on objects loaded as anon.
  unit_cost?: number | null
  category: string | null
  sort_order: number
  image_url: string | null
  is_available: boolean
  // Optional Arabic display word shown next to the item name on the
  // cinema landing's menu grid. Null on rows authored before mig 049.
  display_arabic: string | null
  created_at: string
}

export interface MenuItemAvailability {
  menu_item_id: string
  max_quantity: number
  sold_quantity: number
}

export interface EventMenuItemLimit {
  event_id: string
  menu_item_id: string
  max_quantity: number
}

export interface PickupMenuItemLimit {
  pickup_config_id: string
  menu_item_id: string
  max_quantity: number
}

export interface Guest {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
  phone: string | null
  instagram: string | null
  notification_preference: 'sms' | 'email' | 'both' | 'none'
  // When set, this guest was created as a +1 by the referenced host
  // guest. Null on regular guests. Stamped server-side by add_plus_one().
  added_as_plus_one_by: string | null
  created_at: string
  updated_at: string
}

export interface PublicGuestProfile {
  id: string
  first_name: string
  instagram: string | null
}

export interface RSVP {
  id: string
  event_id: string
  guest_id: string
  status: 'yes' | 'maybe' | 'no' | 'waitlisted'
  waitlist_position: number | null
  waitlisted_at: string | null
  payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded'
  ticket_token: string | null
  paid_at: string | null
  checked_in_at: string | null
  // When set, this row represents a plus-one and points back to the
  // host's RSVP. The host RSVP has plus_one_of = null.
  plus_one_of: string | null
  created_at: string
  updated_at: string
  // Joined
  guest?: PublicGuestProfile
}

export interface TicketView {
  rsvp_id: string
  token: string
  checked_in_at: string | null
  paid_at: string | null
  guest_first_name: string
  guest_last_name: string | null
  event_id: string
  event_title: string
  event_date: string
  event_start_time: string
  event_end_time: string | null
  event_location: string
  event_location_name: string | null
  gathering_number: string | null
}

export interface CheckInResult {
  success: boolean
  error?: string
  already_checked_in?: boolean
  rsvp_id?: string
  guest_first_name?: string
  guest_last_name?: string | null
  event_id?: string
  event_title?: string
  checked_in_at?: string
}

export interface Order {
  id: string
  event_id: string
  guest_id: string
  status: 'pending' | 'paid' | 'cancelled'
  payment_method: 'venmo' | 'stripe'
  total: number | null
  venmo_note: string | null
  created_at: string
  updated_at: string
  // Joined
  items?: OrderItem[]
  guest?: Guest
}

export interface OrderItem {
  id: string
  order_id: string
  menu_item_id: string
  quantity: number
  unit_price: number | null
  unit_cost: number | null
  // Joined
  menu_item?: MenuItem
}

export interface Invite {
  id: string
  event_id: string
  token: string
  invited_by: string | null
  invited_email: string | null
  invited_phone: string | null
  created_at: string
}

export interface NotificationLog {
  id: string
  guest_id: string | null
  event_id: string | null
  channel: 'sms' | 'email'
  type: string
  status: 'sent' | 'failed' | 'queued'
  sent_at: string | null
  error: string | null
}

// Cart types for pre-order flow
export interface CartItem {
  menuItem: MenuItem
  quantity: number
}

// Pickup order system
export interface PickupConfig {
  id: string
  menu_id: string | null
  is_active: boolean
  limits_reset_at: string
  created_at: string
  updated_at: string
  // Joined
  menu?: Menu
  slots?: PickupSlot[]
}

export interface PickupSlot {
  id: string
  pickup_config_id: string
  day_of_week: number // 0=Sunday
  start_time: string
  end_time: string
  max_orders: number | null
  is_active: boolean
  created_at: string
}

export interface PickupOrder {
  id: string
  guest_id: string
  menu_id: string
  pickup_date: string
  pickup_time: string
  status: 'pending' | 'confirmed' | 'paid' | 'picked_up' | 'cancelled'
  payment_method: 'venmo' | 'stripe'
  total: number | null
  venmo_note: string | null
  notes: string | null
  pickup_token: string
  created_at: string
  updated_at: string
  // Joined
  items?: PickupOrderItem[]
  guest?: Guest
}

export interface PickupOrderItem {
  id: string
  pickup_order_id: string
  menu_item_id: string
  quantity: number
  unit_price: number | null
  unit_cost: number | null
  // Joined
  menu_item?: MenuItem
}
