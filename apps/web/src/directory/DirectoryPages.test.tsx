import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { Contribution, Venue } from './api'

vi.mock('./VenueMap', () => ({
  default: () => (
    <p role="status">
      Map unavailable. All venues are still in the list below.
    </p>
  ),
}))

const session = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Fan',
    siteOwner: false,
    providers: ['email'],
  },
  csrfToken: 'test-csrf',
  csrfHeader: 'X-CSRF-TOKEN',
  emailEnabled: true,
  googleEnabled: false,
}
const venue: Venue = {
  id: '00000000-0000-4000-8000-000000000002',
  revision: '00000000-0000-4000-8000-000000000003',
  name: 'Corner dog stand',
  address: '123 Main Street',
  description: 'Community listing',
  latitude: 40,
  longitude: -74,
  menuItems: [],
  photos: [],
}
const contribution: Contribution = {
  id: venue.revision,
  status: 'DRAFT',
  reviewReason: '',
  own: true,
  venue,
}

function show(path: string) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('directory screens', () => {
  it('keeps the approved list usable when the optional map fails, without requesting private contributions', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/auth/session'))
        return Response.json({ ...session, user: null })
      if (request.url.includes('/venues?'))
        return Response.json({ items: [venue], hasMore: false })
      throw new Error('Public browsing must not request private contributions')
    })
    vi.stubGlobal('fetch', fetch)
    show('/venues')
    expect(await screen.findByRole('link', { name: venue.name })).toBeVisible()
    expect(screen.queryByText(/Map unavailable/)).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Load map (external tiles)' }),
    )
    expect(await screen.findByText(/Map unavailable/)).toBeVisible()
    expect(screen.getByRole('link', { name: venue.name })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Review queue' }),
    ).not.toBeInTheDocument()
    expect(
      fetch.mock.calls.some(([request]) =>
        request.url.includes('/contributions'),
      ),
    ).toBe(false)
  })

  it('creates a private draft without automatically submitting it for public review', async () => {
    let body: unknown
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/auth/session')) return Response.json(session)
      if (request.method === 'POST' && request.url.endsWith('/contributions')) {
        expect(request.headers.get('X-CSRF-TOKEN')).toBe('test-csrf')
        body = await request.json()
        return Response.json(contribution, { status: 201 })
      }
      if (
        request.method === 'GET' &&
        request.url.endsWith(`/contributions/${contribution.id}`)
      )
        return Response.json(contribution)
      throw new Error('Saving a draft must not submit or approve it')
    })
    vi.stubGlobal('fetch', fetch)
    show('/venues/new')
    fireEvent.change(await screen.findByLabelText('Venue name'), {
      target: { value: venue.name },
    })
    fireEvent.change(screen.getByLabelText('Public address'), {
      target: { value: venue.address },
    })
    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: '40' },
    })
    fireEvent.change(screen.getByLabelText('Longitude'), {
      target: { value: '-74' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save private draft' }))
    expect(
      await screen.findByRole('button', { name: 'Submit for review' }),
    ).toBeVisible()
    expect(body).toMatchObject({
      name: venue.name,
      latitude: 40,
      longitude: -74,
      menuItems: [],
    })
    expect(
      fetch.mock.calls.some(([request]) => request.url.endsWith('/submit')),
    ).toBe(false)
  })

  it('requires an explicit reason for moderator approval and hides contributor-only actions', async () => {
    let item: Contribution = { ...contribution, status: 'PENDING', own: false }
    let reviewed = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/auth/session'))
          return Response.json({
            ...session,
            user: { ...session.user, siteOwner: true },
          })
        if (request.url.endsWith('/review')) {
          expect(request.headers.get('X-CSRF-TOKEN')).toBe('test-csrf')
          expect(await request.json()).toEqual({
            approve: true,
            reason: 'Confirmed menu and address',
          })
          reviewed = true
          item = {
            ...item,
            status: 'APPROVED',
            reviewReason: 'Confirmed menu and address',
          }
          return Response.json(item)
        }
        return Response.json(item)
      }),
    )
    show(`/directory/contributions/${contribution.id}`)
    expect(
      await screen.findByRole('button', { name: 'Approve listing' }),
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Discard contribution' }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Review reason'), {
      target: { value: 'Confirmed menu and address' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve listing' }))
    await waitFor(() => expect(reviewed).toBe(true))
    expect(
      await screen.findByText('Review: Confirmed menu and address'),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Approve listing' }),
    ).not.toBeInTheDocument()
  })

  it('explains that an approved update replaces photos and preserves the base revision', async () => {
    let submitted: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/auth/session')) return Response.json(session)
        if (request.method === 'POST') {
          submitted = await request.json()
          return Response.json(contribution, { status: 201 })
        }
        if (request.url.includes('/directory/'))
          return Response.json(contribution)
        return Response.json(venue)
      }),
    )
    show(`/venues/${venue.id}/suggest`)
    expect(await screen.findByText(/Reattach any photos/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Save private draft' }))
    await waitFor(() =>
      expect(submitted).toMatchObject({
        venueId: venue.id,
        baseRevision: venue.revision,
      }),
    )
  })
})
