import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { makeQuery } from '../../../test/mocks'

// Hoisted fixtures so they're defined before the vi.mock factory runs.
const fixture = vi.hoisted(() => {
  const event = {
    id: 'evt-1',
    title: 'World Cup Watch Party',
    description: 'Football and free knafeh.',
    date: '2099-08-10',
    start_time: '18:00:00',
    end_time: '23:00:00',
    location: 'East 3rd St',
    location_name: null,
    flyer_url: null,
    home_flyer_url: null,
    menu_id: 'menu-1',
    capacity: 50 as number | null,
    donation_info: null,
    gathering_number: 'No. 014',
    event_type: null,
    rsvp_required: true,
    is_published: true,
    preorder_enabled: true,
    ticketing_enabled: false,
    ticket_price: 0,
    theme: 'theme1',
    display_arabic: 'الكأس',
    tagline: 'Football and free knafeh.',
    highlights: null,
    created_at: '2099-05-01T00:00:00Z',
    updated_at: '2099-05-01T00:00:00Z',
  }
  const menuItems = [
    {
      id: 'mi-1',
      menu_id: 'menu-1',
      name: 'Knafeh Croissant',
      description: 'Cheese, orange-blossom syrup.',
      price: 8,
      category: 'PASTRY',
      sort_order: 0,
      image_url: null,
      is_available: true,
      display_arabic: 'كنافة',
      created_at: '2099-05-01T00:00:00Z',
    },
    {
      id: 'mi-2',
      menu_id: 'menu-1',
      name: 'Pistachio Bun',
      description: 'Brown butter, Aleppo pistachio.',
      price: 7,
      category: 'BUNS',
      sort_order: 1,
      image_url: null,
      is_available: true,
      display_arabic: null,
      created_at: '2099-05-01T00:00:00Z',
    },
  ]
  const settings = {
    id: 'settings-1',
    venmo_handle: 'cafekadhem',
    contact_email: null,
    site_url: 'https://cafekadhem.com',
    theme: 'theme1',
    sms_enabled: false,
    current_menu_blurb: null,
    updated_at: '2099-05-01T00:00:00Z',
  }
  return { event, menuItems, settings }
})

vi.mock('../../../lib/supabase', () => {
  // Route the right query result to each `from(table)` call. The order
  // of `from` calls inside the loader determines the rows we serve;
  // we use a per-table mux so the tests don't depend on call order.
  const stub = {
    from(table: string) {
      if (table === 'events') return makeQuery({ data: fixture.event })
      if (table === 'public_menu_items') return makeQuery({ data: fixture.menuItems })
      if (table === 'admin_settings') return makeQuery({ data: fixture.settings })
      if (table === 'rsvps') return makeQuery({ data: [] })
      return makeQuery({})
    },
    rpc(name: string) {
      if (name === 'event_menu_item_availability') {
        return Promise.resolve({ data: [], error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  }
  return { supabase: stub }
})

import { CinemaEventDetail } from './CinemaEventDetail'

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/events/evt-1']}>
      <Routes>
        <Route path="/events/:id" element={<CinemaEventDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CinemaEventDetail — pre-order cart', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2099-05-01T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the menu items in cinema cells', async () => {
    renderDetail()
    // Note: cinema cells use CSS text-transform: uppercase, but the
    // underlying text node is the original title-case string. Tests
    // match the source text, not the rendered uppercase.
    expect(await screen.findByText('Knafeh Croissant')).toBeInTheDocument()
    expect(screen.getByText('Pistachio Bun')).toBeInTheDocument()
    expect(screen.getByText('كنافة')).toBeInTheDocument()
  })

  it('shows + Add buttons on each menu cell when no items in cart', async () => {
    renderDetail()
    await screen.findByText('Knafeh Croissant')
    const addButtons = screen.getAllByRole('button', { name: /add .* to cart/i })
    expect(addButtons.length).toBe(2)
  })

  it('clicking + Add reveals the sticky cart bar with the running total', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDetail()
    await screen.findByText('Pistachio Bun')

    await user.click(
      screen.getByRole('button', { name: /add pistachio bun to cart/i }),
    )
    expect(screen.getByText(/Cart · 1 item/i)).toBeInTheDocument()
    expect(screen.getByText('$7.00')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /add knafeh croissant to cart/i }),
    )
    expect(screen.getByText(/Cart · 2 items/i)).toBeInTheDocument()
    expect(screen.getByText('$15.00')).toBeInTheDocument()
  })

  it('clicking Checkout opens the cart modal with line items', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDetail()
    await screen.findByText('Pistachio Bun')

    await user.click(
      screen.getByRole('button', { name: /add pistachio bun to cart/i }),
    )
    await user.click(screen.getByRole('button', { name: /^checkout/i }))

    const dialog = screen.getByRole('dialog', { name: /pre-order checkout/i })
    expect(within(dialog).getByText('Your cart.')).toBeInTheDocument()
    expect(within(dialog).getByText('Pistachio Bun')).toBeInTheDocument()
    expect(within(dialog).getByText(/Pay \$7.00 with Venmo/i)).toBeInTheDocument()
  })
})

describe('CinemaEventDetail — view-only menu (preorder disabled)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2099-05-01T12:00:00Z'))
    fixture.event.preorder_enabled = false
  })
  afterEach(() => {
    vi.useRealTimers()
    fixture.event.preorder_enabled = true
  })

  it('still renders the menu items', async () => {
    renderDetail()
    expect(await screen.findByText('Knafeh Croissant')).toBeInTheDocument()
    expect(screen.getByText('Pistachio Bun')).toBeInTheDocument()
  })

  it('hides add-to-cart buttons and the pre-order nudge', async () => {
    renderDetail()
    await screen.findByText('Knafeh Croissant')
    expect(
      screen.queryByRole('button', { name: /add .* to cart/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/pre-order food too/i)).not.toBeInTheDocument()
  })
})

describe('CinemaEventDetail — ticket / seat availability', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2099-05-01T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows remaining + total from capacity (seats, non-ticketed)', async () => {
    renderDetail()
    await screen.findByText('Knafeh Croissant')
    // capacity 50, no RSVPs going -> "50 of 50 seats left"
    expect(screen.getByText(/of 50 seats left/i)).toBeInTheDocument()
  })

  it('labels the unit "tickets" when ticketing is enabled', async () => {
    fixture.event.ticketing_enabled = true
    try {
      renderDetail()
      await screen.findByText('Knafeh Croissant')
      expect(screen.getByText(/of 50 tickets left/i)).toBeInTheDocument()
    } finally {
      fixture.event.ticketing_enabled = false
    }
  })

  it('hides the counter when capacity is unset (unlimited)', async () => {
    fixture.event.capacity = null
    try {
      renderDetail()
      await screen.findByText('Knafeh Croissant')
      expect(screen.queryByText(/seats left/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/tickets left/i)).not.toBeInTheDocument()
    } finally {
      fixture.event.capacity = 50
    }
  })
})
