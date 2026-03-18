export interface AdminSettings {
  id: string
  venmo_handle: string
  cafe_name: string
  contact_email: string | null
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
  flyer_url: string | null
  menu_id: string | null
  capacity: number | null
  donation_info: string | null
  is_published: boolean
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
  category: string | null
  sort_order: number
  image_url: string | null
  is_available: boolean
  created_at: string
}

export interface Guest {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
  phone: string | null
  instagram: string | null
  notification_preference: 'sms' | 'email' | 'none'
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
  created_at: string
  updated_at: string
  // Joined
  guest?: PublicGuestProfile
}

export interface Order {
  id: string
  event_id: string
  guest_id: string
  status: 'pending' | 'confirmed' | 'paid' | 'cancelled'
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
