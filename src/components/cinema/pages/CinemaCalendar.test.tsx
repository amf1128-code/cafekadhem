import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { makeSupabaseStub } from '../../../test/mocks'

// Mock supabase before importing the component. The calendar reads
// `supabase.from('events').select('*').eq('is_published', true).order(...)`.
// The fixture is wrapped in vi.hoisted so it lifts above the vi.mock
// call (which is also hoisted to the top of the file).
const { eventsRows } = vi.hoisted(() => ({
  eventsRows: [
  // Future event
  {
    id: 'evt-1',
    title: 'World Cup Watch Party',
    description: null,
    date: '2026-08-10',
    start_time: '18:00:00',
    end_time: '23:00:00',
    location: 'East 3rd St',
    location_name: null,
    flyer_url: null,
    home_flyer_url: null,
    menu_id: null,
    capacity: null,
    donation_info: null,
    gathering_number: 'No. 014',
    event_type: null,
    rsvp_required: true,
    is_published: true,
    ticketing_enabled: false,
    ticket_price: 0,
    theme: 'theme1',
    display_arabic: 'الكأس',
    tagline: 'Football and free knafeh.',
    highlights: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
  // Past event
  {
    id: 'evt-0',
    title: 'Cafe Kadhem Turns One',
    description: null,
    date: '2026-04-15',
    start_time: '13:00:00',
    end_time: '18:00:00',
    location: '167 Utica Ave',
    location_name: 'Barzakh',
    flyer_url: null,
    home_flyer_url: null,
    menu_id: null,
    capacity: null,
    donation_info: null,
    gathering_number: 'No. 006',
    event_type: null,
    rsvp_required: false,
    is_published: true,
    ticketing_enabled: false,
    ticket_price: 0,
    theme: 'theme1',
    display_arabic: null,
    tagline: null,
    highlights: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  ],
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: makeSupabaseStub({
    tables: {
      events: { data: eventsRows },
    },
  }),
}))

import { CinemaCalendar } from './CinemaCalendar'

describe('CinemaCalendar', () => {
  // Pin "now" to a date between the past + future event so partition
  // logic is deterministic. `toFake: ['Date']` keeps real microtask /
  // setTimeout scheduling — otherwise the Supabase mock's resolved
  // promises never flush during render.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the page header', async () => {
    render(
      <MemoryRouter>
        <CinemaCalendar />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('THE CALENDAR.')).toBeInTheDocument()
    })
    expect(screen.getByText('UPCOMING.')).toBeInTheDocument()
    expect(screen.getByText('PAST GATHERINGS.')).toBeInTheDocument()
  })

  it('lists upcoming and past events in their correct sections', async () => {
    render(
      <MemoryRouter>
        <CinemaCalendar />
      </MemoryRouter>,
    )
    await waitFor(() => {
      // Upcoming
      expect(screen.getByText('World Cup Watch Party')).toBeInTheDocument()
      expect(screen.getByText('الكأس')).toBeInTheDocument()
      expect(screen.getByText('Football and free knafeh.')).toBeInTheDocument()
      // Past
      expect(screen.getByText('Cafe Kadhem Turns One')).toBeInTheDocument()
    })
  })

  it('links each row to /events/:id', async () => {
    render(
      <MemoryRouter>
        <CinemaCalendar />
      </MemoryRouter>,
    )
    await waitFor(() => {
      const upcoming = screen.getByText('World Cup Watch Party').closest('a')
      expect(upcoming).toHaveAttribute('href', '/events/evt-1')
    })
  })
})
