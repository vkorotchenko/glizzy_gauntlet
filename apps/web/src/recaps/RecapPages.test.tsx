import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { Competition } from '../competitions/api'
import type { Correction } from './api'

const session = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Captain',
    siteOwner: false,
    providers: ['email'],
  },
  csrfToken: 'test-csrf',
  csrfHeader: 'X-CSRF-TOKEN',
  emailEnabled: true,
  googleEnabled: false,
}
const competition: Competition = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Recap crew',
  rules: '',
  visibility: 'PUBLIC',
  timeZone: 'UTC',
  startsAt: '2026-10-01T00:00:00Z',
  endsAt: '2026-10-27T00:00:00Z',
  submissionClosesAt: '2026-10-28T00:00:00Z',
  published: true,
  allowSharedMeals: true,
  version: 1,
  phase: 'FINALIZED',
  viewerRole: 'ORGANIZER',
  memberCount: 1,
}
const versions = [
  {
    version: 2,
    state: 'REVISED',
    createdAt: '2026-10-28T11:00:00Z',
    calculationVersion: 1,
  },
  {
    version: 1,
    state: 'FINAL',
    createdAt: '2026-10-28T10:00:00Z',
    calculationVersion: 1,
  },
]
const entry = {
  id: '00000000-0000-4000-8000-000000000003',
  displayName: 'Captain',
  version: 1,
  scoreExcluded: false,
  totalHundredths: 1900,
  wholeHotDogs: 2,
  revision: {
    id: '00000000-0000-4000-8000-000000000004',
    version: 1,
    eatenAt: '2026-10-26T12:00:00Z',
    venueId: null,
    location: 'Secret picnic',
    notes: '',
    items: [
      {
        name: 'Measured dog',
        wholeQuantity: 2,
        unitHundredths: 800,
        partialHundredths: 300,
      },
    ],
    photoIds: [],
    totalHundredths: 1900,
    wholeHotDogs: 2,
  },
}
function show(path = `/competitions/${competition.id}/recap`) {
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
function reply(request: Request) {
  const url = new URL(request.url)
  if (url.pathname.endsWith('/auth/session')) return Response.json(session)
  if (url.pathname.endsWith(`/competitions/${competition.id}`))
    return Response.json(competition)
  if (url.pathname.endsWith('/meals'))
    return Response.json({ items: [entry], hasMore: false })
  if (url.pathname.endsWith('/recap/history'))
    return Response.json({ items: versions, hasMore: false })
  if (url.pathname.endsWith('/corrections'))
    return Response.json({ items: [], hasMore: false })
  if (url.pathname.endsWith('/recap')) {
    const version = Number(url.searchParams.get('version') ?? 2)
    const total = version === 1 ? 1900 : 1700
    return Response.json({
      result: versions.find((item) => item.version === version),
      participantCount: 1,
      totalHundredths: total,
      wholeHotDogs: 2,
      standings: [
        {
          rank: 1,
          displayName: 'Captain',
          totalHundredths: total,
          wholeHotDogs: 2,
        },
      ],
      hasMore: false,
    })
  }
  if (url.pathname.endsWith('/recap/highlights'))
    return Response.json({
      resultVersion: Number(url.searchParams.get('version')),
      mealCount: 1,
      venueCount: 0,
      privateLocationCount: 1,
      largestMealHundredths: 1900,
      busiestDay: '2026-10-26',
      busiestDayHundredths: 1900,
      timeZone: 'UTC',
      places: [
        {
          location: 'Secret picnic',
          directoryVenue: false,
          mealCount: 1,
          totalHundredths: 1900,
        },
      ],
    })
  throw new Error(`Unexpected request ${request.url}`)
}

describe('versioned recaps and score corrections', () => {
  it('lets public visitors browse immutable revisions without requesting member highlights or audit', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/auth/session'))
        return Response.json({ ...session, user: null })
      if (request.url.endsWith(`/competitions/${competition.id}`))
        return Response.json({ ...competition, viewerRole: 'NONE' })
      return reply(request)
    })
    vi.stubGlobal('fetch', fetch)
    show()
    expect(await screen.findByText('Revised recap / Revision 2')).toBeVisible()
    expect(
      within(screen.getByLabelText('Recap totals')).getByText('17.00'),
    ).toBeVisible()
    fireEvent.click(
      await screen.findByRole('button', { name: 'View revision 1' }),
    )
    expect(await screen.findByText('Final recap / Revision 1')).toBeVisible()
    expect(
      within(screen.getByLabelText('Recap totals')).getByText('19.00'),
    ).toBeVisible()
    expect(
      fetch.mock.calls.some(([request]) =>
        /\/highlights|\/corrections/.test(new URL(request.url).pathname),
      ),
    ).toBe(false)
    expect(screen.queryByText('Secret picnic')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Correct competition scores' }),
    ).not.toBeInTheDocument()
  })

  it('requests member highlights for the displayed revision, not an unrelated latest result', async () => {
    const fetch = vi.fn(async (request: Request) => reply(request))
    vi.stubGlobal('fetch', fetch)
    show(`/competitions/${competition.id}/recap?version=1`)
    expect(await screen.findByText('Secret picnic')).toBeVisible()
    expect(
      screen.getByText(/These details belong to recap revision 1/),
    ).toBeVisible()
    expect(
      fetch.mock.calls.some(
        ([request]) =>
          new URL(request.url).pathname.endsWith('/recap/highlights') &&
          new URL(request.url).searchParams.get('version') === '1',
      ),
    ).toBe(true)
    expect(
      screen.getByRole('link', { name: 'My progress (latest revision)' }),
    ).toBeVisible()
  })

  it('publishes an explicit CSRF-protected score correction and reuses the same retry key', async () => {
    const saved: Correction[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'POST') {
          expect(request.headers.get('X-CSRF-TOKEN')).toBe('test-csrf')
          saved.push((await request.json()) as Correction)
          return saved.length === 1
            ? Response.json({ error: 'API_UNAVAILABLE' }, { status: 503 })
            : Response.json({ resultVersion: 2, entryVersion: 2 })
        }
        return reply(request)
      }),
    )
    show(`/competitions/${competition.id}/corrections`)
    fireEvent.change(await screen.findByLabelText('Corrected total inches'), {
      target: { value: '17' },
    })
    fireEvent.change(
      screen.getByLabelText('Reason for correction (visible to members)'),
      { target: { value: 'Measured correction' } },
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Publish corrected recap' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load or save',
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Publish corrected recap' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Published recap revision 2.',
    )
    expect(saved).toHaveLength(2)
    expect(saved[0]).toEqual(saved[1])
    expect(saved[0]).toMatchObject({
      version: 1,
      totalHundredths: 1700,
      wholeHotDogs: 2,
      excluded: false,
      reason: 'Measured correction',
    })
    expect(
      screen.getByText(/Original measurements: 19.00 inches/),
    ).toBeVisible()
  })

  it('rejects zero retained scores locally without sending a correction', async () => {
    const fetch = vi.fn(async (request: Request) => reply(request))
    vi.stubGlobal('fetch', fetch)
    show(`/competitions/${competition.id}/corrections`)
    fireEvent.change(await screen.findByLabelText('Corrected total inches'), {
      target: { value: '0' },
    })
    fireEvent.change(
      screen.getByLabelText('Reason for correction (visible to members)'),
      { target: { value: 'Reason' } },
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Publish corrected recap' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'use scoring exclusion',
    )
    expect(
      fetch.mock.calls.some(([request]) => request.method === 'POST'),
    ).toBe(false)
  })

  it('does not request correction entries for a participant', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith(`/competitions/${competition.id}`))
        return Response.json({ ...competition, viewerRole: 'MEMBER' })
      return reply(request)
    })
    vi.stubGlobal('fetch', fetch)
    show(`/competitions/${competition.id}/corrections`)
    expect(
      await screen.findByText(
        'Only this competition organizer can correct scores.',
      ),
    ).toBeVisible()
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([request]) =>
          new URL(request.url).pathname.endsWith('/meals'),
        ),
      ).toBe(false),
    )
  })
})
