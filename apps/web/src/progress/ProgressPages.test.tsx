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
import type { Progress } from './api'

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
  name: 'Measured crew',
  rules: '',
  visibility: 'PUBLIC',
  timeZone: 'America/New_York',
  startsAt: '2026-09-01T04:00:00Z',
  endsAt: '2026-10-28T04:00:00Z',
  submissionClosesAt: '2026-10-29T04:00:00Z',
  allowSharedMeals: true,
  published: true,
  version: 1,
  phase: 'GRACE',
  viewerRole: 'MEMBER',
  memberCount: 3,
}
const progress: Progress = {
  timeZone: competition.timeZone,
  provisional: true,
  rank: 1,
  totalHundredths: 1900,
  wholeHotDogs: 2,
  mealCount: 1,
  venueCount: 0,
  privateLocationCount: 1,
  days: [
    {
      date: '2026-10-26',
      totalHundredths: 0,
      wholeHotDogs: 0,
      mealCount: 0,
      cumulativeHundredths: 400,
    },
    {
      date: '2026-10-27',
      totalHundredths: 1500,
      wholeHotDogs: 2,
      mealCount: 1,
      cumulativeHundredths: 1900,
    },
  ],
  daysHasMore: true,
  placesHasMore: true,
  places: [
    {
      venueId: null,
      location: 'Secret picnic',
      mealCount: 1,
      totalHundredths: 1900,
    },
  ],
  recentMeals: [
    {
      mealId: '00000000-0000-4000-8000-000000000003',
      revisionId: '00000000-0000-4000-8000-000000000004',
      eatenAt: '2026-10-27T16:00:00Z',
      location: 'Secret picnic',
      totalHundredths: 1900,
      wholeHotDogs: 2,
    },
  ],
}
function show(path = `/competitions/${competition.id}/progress`) {
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
  if (request.url.endsWith('/auth/session')) return Response.json(session)
  if (request.url.endsWith(`/competitions/${competition.id}`))
    return Response.json(competition)
  if (request.url.includes('/progress?')) return Response.json(progress)
  if (request.url.endsWith('/featured-venues')) return Response.json([])
  if (request.url.includes('/members?') || request.url.includes('/meals?'))
    return Response.json({ items: [], hasMore: false })
  throw new Error(`Unexpected request: ${request.url}`)
}

describe('standings and progress', () => {
  it('shows tied public ranks without requesting personal or member activity for visitors', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/auth/session'))
        return Response.json({ ...session, user: null })
      if (request.url.endsWith(`/competitions/${competition.id}`))
        return Response.json({ ...competition, viewerRole: 'NONE' })
      if (request.url.includes('/standings?'))
        return Response.json({
          items: [
            {
              rank: 1,
              displayName: 'Captain',
              totalHundredths: 1900,
              wholeHotDogs: 2,
            },
            {
              rank: 1,
              displayName: 'Friend',
              totalHundredths: 1900,
              wholeHotDogs: 3,
            },
            {
              rank: 3,
              displayName: 'Third',
              totalHundredths: 800,
              wholeHotDogs: 1,
            },
          ],
          hasMore: false,
          provisional: true,
        })
      return reply(request)
    })
    vi.stubGlobal('fetch', fetch)
    show(`/competitions/${competition.id}`)
    const table = await screen.findByRole('table', {
      name: 'Provisional standings',
    })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(
      rows.map((row) => within(row).getAllByRole('cell')[0].textContent),
    ).toEqual(['1', '1', '3'])
    expect(within(rows[0]).getByText('19.00')).toBeVisible()
    expect(
      fetch.mock.calls.some(([request]) =>
        /\/progress|\/members|\/meals/.test(new URL(request.url).pathname),
      ),
    ).toBe(false)
    expect(
      screen.queryByRole('link', { name: 'My competition progress' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Secret picnic')).not.toBeInTheDocument()
  })

  it('renders snapshot totals, both chart modes, exact data and independent day/place pagination', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.includes('/progress?')) {
        const query = new URL(request.url).searchParams
        return Response.json({
          ...progress,
          daysHasMore: query.get('dayPage') === '0',
          days:
            query.get('dayPage') === '0' ? progress.days : [progress.days[0]],
          placesHasMore: query.get('placePage') === '0',
          places: query.get('placePage') === '0' ? progress.places : [],
        })
      }
      return reply(request)
    })
    vi.stubGlobal('fetch', fetch)
    show()
    const totals = await screen.findByLabelText('Your competition totals')
    expect(within(totals).getByText('19.00')).toBeVisible()
    expect(within(totals).getByText('1 (ties share a rank)')).toBeVisible()
    expect(screen.getByText(/Archived sources still count/)).toBeVisible()
    expect(screen.getByText(/Your progress is provisional/)).toBeVisible()
    expect(
      screen.getByRole('img', { name: /Daily inches in America\/New_York/ }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cumulative chart' }))
    expect(
      screen.getByRole('img', {
        name: /Cumulative inches in America\/New_York/,
      }),
    ).toBeVisible()
    const table = screen.getByRole('table', {
      name: 'Exact daily and cumulative totals',
    })
    expect(
      within(table).getByRole('row', { name: '2026-10-26 0.00 4.00 0 0' }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'View private source' }),
    ).toHaveAttribute('href', `/meals/${progress.recentMeals[0].mealId}`)
    fireEvent.click(screen.getByRole('button', { name: 'Older days' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Older days' })).toBeDisabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next places page' }))
    expect(
      await screen.findByText('No visited places on this page.'),
    ).toBeVisible()
    expect(
      fetch.mock.calls.some(
        ([request]) =>
          new URL(request.url).searchParams.get('dayPage') === '1' &&
          new URL(request.url).searchParams.get('placePage') === '1',
      ),
    ).toBe(true)
    expect(
      fetch.mock.calls.every(([request]) => request.method === 'GET'),
    ).toBe(true)
  })

  it.each(['signed out', 'not joined'])(
    'does not request personal data when %s',
    async (state) => {
      const fetch = vi.fn(async (request: Request) => {
        if (request.url.endsWith('/auth/session'))
          return Response.json({
            ...session,
            user: state === 'signed out' ? null : session.user,
          })
        if (request.url.endsWith(`/competitions/${competition.id}`))
          return Response.json({ ...competition, viewerRole: 'NONE' })
        return reply(request)
      })
      vi.stubGlobal('fetch', fetch)
      show()
      if (state === 'signed out')
        expect(
          await screen.findByRole('link', { name: 'Sign in' }),
        ).toBeVisible()
      else
        expect(
          await screen.findByText(
            'Join this competition to view your own progress.',
          ),
        ).toBeVisible()
      expect(
        fetch.mock.calls.some(([request]) =>
          request.url.includes('/progress?'),
        ),
      ).toBe(false)
    },
  )

  it('recovers from a progress error through an explicit retry', async () => {
    let attempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.includes('/progress?') && ++attempts === 1)
          return Response.json({ error: 'API_UNAVAILABLE' }, { status: 503 })
        return reply(request)
      }),
    )
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load results',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByLabelText('Your competition totals'),
    ).toBeVisible()
    expect(attempts).toBe(2)
  })
})
