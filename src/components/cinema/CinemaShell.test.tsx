import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { makeSupabaseStub } from '../../test/mocks'

// Mock supabase before the component imports run. The shell's
// `useMyGuest` calls `supabase.rpc('get_my_guest', ...)`, plus the
// admin-settings reads from the recognition strip don't fire here.
vi.mock('../../lib/supabase', () => ({
  supabase: makeSupabaseStub({
    rpcs: { get_my_guest: null },
  }),
}))

import { CinemaShell } from './CinemaShell'

function renderShell(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<CinemaShell />}>
          <Route path="/" element={<div data-testid="body">HOME BODY</div>} />
          <Route path="/calendar" element={<div data-testid="body">CAL BODY</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('CinemaShell', () => {
  it('renders top strip + nav + body + footer', async () => {
    renderShell('/')
    expect(
      screen.getByText(/POP-UP CAFE SERIES · NEW YORK · EST\. 2025/),
    ).toBeInTheDocument()
    // Nav links
    expect(screen.getAllByText('CALENDAR')[0]).toBeInTheDocument()
    expect(screen.getByText('MENU')).toBeInTheDocument()
    expect(screen.getByText('STORY')).toBeInTheDocument()
    // Body slot
    expect(screen.getByTestId('body')).toHaveTextContent('HOME BODY')
    // Footer Arabic signoff
    expect(screen.getByText('صحتين')).toBeInTheDocument()
  })

  it('shows "All Events →" CTA on home and "Save a Spot →" elsewhere', () => {
    const { unmount } = renderShell('/')
    expect(screen.getByText(/All Events/i)).toBeInTheDocument()
    unmount()

    renderShell('/calendar')
    expect(screen.getByText(/Save a Spot/i)).toBeInTheDocument()
  })

  it('shows the "I\'ve been here before →" link when no guest is recognized', async () => {
    renderShell('/')
    await waitFor(() => {
      expect(screen.getByText(/I.ve been here before/i)).toBeInTheDocument()
    })
  })
})
