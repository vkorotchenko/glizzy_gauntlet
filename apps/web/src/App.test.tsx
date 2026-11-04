import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import * as auth from './auth/api'
import type { FeedItem } from './feed/api'

const session = {
  user: null,
  csrfToken: 'test-csrf-token',
  csrfHeader: 'X-CSRF-TOKEN',
  googleEnabled: false,
  emailEnabled: true,
}
const signedInSession = {
  ...session,
  user: {
    id: 'test-user',
    displayName: 'Diner',
    providers: ['email'],
    siteOwner: false,
    roles: [],
  },
} satisfies Awaited<ReturnType<typeof auth.loadSession>>
const meal: FeedItem = {
  id: 'entry-one',
  competitionId: 'competition-one',
  competitionName: 'Lunch crew',
  displayName: 'Pickle captain',
  revision: {
    id: 'submitted-revision',
    version: 1,
    eatenAt: '2026-10-28T12:00:00Z',
    venueId: null,
    location: 'The corner stand',
    notes: 'A very good lunch.',
    items: [
      {
        name: 'Classic',
        wholeQuantity: 2,
        unitHundredths: 800,
        partialHundredths: 300,
      },
    ],
    photoIds: ['meal-photo'],
    totalHundredths: 1900,
    wholeHotDogs: 2,
  },
  scoreExcluded: false,
  totalHundredths: 1900,
  wholeHotDogs: 2,
  reactionCount: 0,
  reacted: false,
}

beforeEach(() => {
  vi.spyOn(auth, 'loadSession').mockResolvedValue(session)
})

function renderApp(path = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('main navigation', () => {
  it('marks Feed on the landing page and the current section after navigation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ items: [], hasMore: false })),
    )
    renderApp()
    const navigation = within(
      screen.getByRole('navigation', { name: 'Main navigation' }),
    )
    const feed = navigation.getByRole('link', { name: 'Feed' })
    expect(feed).toHaveAttribute('href', '/')
    expect(feed).toHaveAttribute('aria-current', 'page')
    fireEvent.click(navigation.getByRole('link', { name: 'Competitions' }))
    expect(
      await screen.findByRole('heading', { name: 'Competitions' }),
    ).toBeVisible()
    expect(
      navigation.getByRole('link', { name: 'Competitions' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(feed).not.toHaveAttribute('aria-current')
  })

  it('shows visitors a sign-in button instead of personal links', async () => {
    renderApp('/not-a-page')
    const navigation = within(
      screen.getByRole('navigation', { name: 'Main navigation' }),
    )

    expect(
      await navigation.findByRole('link', { name: 'Sign in' }),
    ).toHaveAttribute('href', '/sign-in')
    expect(
      navigation.queryByRole('link', { name: 'My meals' }),
    ).not.toBeInTheDocument()
    expect(
      navigation.queryByRole('link', { name: 'My account' }),
    ).not.toBeInTheDocument()
    expect(
      navigation.queryByRole('link', { name: 'Venues' }),
    ).not.toBeInTheDocument()
    expect(
      navigation.getByRole('link', { name: 'Competitions' }),
    ).toHaveAttribute('href', '/competitions')
  })

  it('shows personal links instead of sign-in for authenticated users', async () => {
    vi.mocked(auth.loadSession).mockResolvedValue(signedInSession)
    renderApp('/not-a-page')
    const navigation = within(
      screen.getByRole('navigation', { name: 'Main navigation' }),
    )

    expect(
      await navigation.findByRole('link', { name: 'My account' }),
    ).toHaveAttribute('href', '/account')
    expect(
      navigation.queryByRole('link', { name: 'My meals' }),
    ).not.toBeInTheDocument()
    expect(navigation.getByRole('link', { name: 'Venues' })).toHaveAttribute(
      'href',
      '/venues',
    )
    expect(
      navigation.queryByRole('link', { name: 'Sign in' }),
    ).not.toBeInTheDocument()
  })
})

describe('home feed', () => {
  it('shows visitors two public competitions and a sign-in prompt without requesting meals', async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toMatch(/\/competitions\?scope=public&page=0$/)
      return Response.json({
        items: [1, 2, 3].map((id) => ({
          id: `public-${id}`,
          name: `Public crew ${id}`,
          startsAt: '2026-11-28T12:00:00Z',
          timeZone: 'UTC',
          memberCount: id,
        })),
        hasMore: false,
      })
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()

    expect(
      await screen.findByRole('link', { name: 'Public crew 1' }),
    ).toHaveAttribute('href', '/competitions/public-1')
    expect(
      screen.getByRole('link', { name: 'Public crew 2' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Public crew 3')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Sign in to see your feed' }),
    ).toHaveAttribute('href', '/sign-in')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('shows submitted meal cards across the signed-in competitions', async () => {
    vi.mocked(auth.loadSession).mockResolvedValue(signedInSession)
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toMatch(/\/feed\?page=0$/)
      return Response.json({
        items: [
          meal,
          {
            ...meal,
            id: 'entry-two',
            competitionId: 'competition-two',
            competitionName: 'Dinner crew',
          },
        ],
        hasMore: false,
      })
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()

    expect(await screen.findAllByRole('article')).toHaveLength(2)
    expect(
      within(
        screen.getByRole('heading', { name: 'Your feed' }).parentElement!,
      ).getByRole('link', { name: 'Log a meal' }),
    ).toBeVisible()
    expect(screen.queryByText('Sample meal')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lunch crew' })).toHaveAttribute(
      'href',
      '/competitions/competition-one',
    )
    expect(
      screen.getByRole('link', { name: 'Dinner crew' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('19.00 inches')).toHaveLength(2)
    for (const card of screen.getAllByRole('article')) {
      const footer = within(card).getByRole('group', {
        name: 'Meal totals and likes',
      })
      expect(footer).toBe(card.lastElementChild)
      expect(within(footer).getByText('2 hot dogs')).toBeVisible()
      expect(within(footer).getByText('0 likes')).toBeVisible()
      expect(
        within(footer).getByRole('button', { name: 'Like' }),
      ).toHaveAttribute('aria-pressed', 'false')
    }
    expect(screen.getAllByText('A very good lunch.')).toHaveLength(2)
    expect(
      screen.getAllByRole('img', { name: 'Meal photo 1' })[0],
    ).toHaveAttribute('src', '/api/v1/meal-photos/meal-photo?thumbnail=true')
    expect(
      screen.queryByRole('link', { name: 'Sign in to see your feed' }),
    ).not.toBeInTheDocument()
  })

  it.each([
    { whole: 1, total: 0, label: '1 hot dog' },
    { whole: 0, total: 450, label: '0 hot dogs' },
  ])(
    'keeps likes beside totals for $label meals',
    async ({ whole, total, label }) => {
      vi.mocked(auth.loadSession).mockResolvedValue(signedInSession)
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({
            items: [
              {
                ...meal,
                wholeHotDogs: whole,
                totalHundredths: total,
                revision: {
                  ...meal.revision,
                  wholeHotDogs: whole,
                  totalHundredths: total,
                  items: [],
                },
              },
            ],
            hasMore: false,
          }),
        ),
      )
      renderApp()
      const footer = await screen.findByRole('group', {
        name: 'Meal totals and likes',
      })
      expect(within(footer).getByText(label)).toBeVisible()
      expect(within(footer).getByText('0 likes')).toBeVisible()
      if (total) expect(within(footer).getByText('4.50 inches')).toBeVisible()
      else expect(within(footer).queryByText(/inches/)).not.toBeInTheDocument()
    },
  )

  it('shows two clearly labeled hotdog examples only when the first feed page is empty', async () => {
    vi.mocked(auth.loadSession).mockResolvedValue(signedInSession)
    const fetch = vi.fn(async () =>
      Response.json({ items: [], hasMore: false }),
    )
    vi.stubGlobal('fetch', fetch)
    renderApp()
    expect(
      await screen.findAllByRole('heading', { name: 'glizzy gauntlet' }),
    ).toHaveLength(2)
    expect(
      screen.getAllByRole('img', { name: /sample illustration/ }),
    ).toHaveLength(2)
    expect(screen.getAllByText(/Getting started \/ Sample meal/)).toHaveLength(
      2,
    )
    expect(screen.getByText(/Example data, not real people/)).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Like' }),
    ).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('opens a competition preview and an account-benefits tutorial from the sample cards', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ items: [], hasMore: false })),
    )
    renderApp()
    fireEvent.click(
      await screen.findByRole('link', {
        name: 'Start a competition',
      }),
    )
    expect(
      await screen.findByRole('table', {
        name: 'Example competition standings',
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'From idea to leaderboard' }),
    ).not.toBeInTheDocument()
    const competitions = screen.getByRole('link', { name: 'View competitions' })
    expect(competitions).toHaveAttribute('href', '/competitions')
    fireEvent.click(competitions)
    expect(
      await screen.findByRole('heading', { name: 'Competitions', level: 1 }),
    ).toBeVisible()
    fireEvent.click(
      within(
        screen.getByRole('navigation', { name: 'Main navigation' }),
      ).getByRole('link', { name: 'Feed' }),
    )
    fireEvent.click(
      await screen.findByRole('link', {
        name: 'Log in or create an account',
      }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Your seat at the table' }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Sign in or create your account' }),
    ).toHaveAttribute('href', '/sign-in')
  })

  it('links signed-in members directly from the competition preview to competitions', async () => {
    vi.mocked(auth.loadSession).mockResolvedValue(signedInSession)
    renderApp('/learn/competitions')
    await within(
      screen.getByRole('navigation', { name: 'Main navigation' }),
    ).findByRole('link', { name: 'My account' })
    const tutorial = within(
      screen
        .getByRole('heading', { name: 'Start a competition' })
        .closest('section')!,
    )
    expect(
      tutorial.getByRole('link', { name: 'View competitions' }),
    ).toHaveAttribute('href', '/competitions')
    expect(tutorial.getAllByRole('link')).toHaveLength(2)
    expect(tutorial.queryByRole('list')).not.toBeInTheDocument()
    expect(
      tutorial.queryByRole('heading', { name: 'From idea to leaderboard' }),
    ).not.toBeInTheDocument()
  })

  it('does not replace a failed feed request with sample meals', async () => {
    vi.mocked(auth.loadSession).mockResolvedValue(signedInSession)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'UNAVAILABLE' }, { status: 503 }),
      ),
    )
    renderApp()
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('adds and removes likes using CSRF and authoritative counts', async () => {
    vi.mocked(auth.loadSession).mockResolvedValue(signedInSession)
    const desiredStates: boolean[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'GET')
          return Response.json({
            items: [{ ...meal, reactionCount: 7 }],
            hasMore: false,
          })
        expect(request.url).toMatch(/\/feed\/entry-one\/reaction$/)
        expect(request.headers.get('X-CSRF-TOKEN')).toBe('test-csrf-token')
        const { reacted } = await request.json()
        desiredStates.push(reacted)
        return Response.json({ reactionCount: reacted ? 8 : 7, reacted })
      }),
    )
    renderApp()

    fireEvent.click(await screen.findByRole('button', { name: 'Like' }))
    expect(
      await screen.findByRole('button', { name: 'Liked' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('8 likes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Liked' }))
    expect(await screen.findByRole('button', { name: 'Like' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByText('7 likes')).toBeInTheDocument()
    expect(desiredStates).toEqual([true, false])
  })

  it('keeps a failed reaction unchanged and allows an idempotent retry', async () => {
    vi.mocked(auth.loadSession).mockResolvedValue(signedInSession)
    let attempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'GET')
          return Response.json({ items: [meal], hasMore: false })
        expect(await request.json()).toEqual({ reacted: true })
        return ++attempts === 1
          ? Response.json({ error: 'UNAVAILABLE' }, { status: 503 })
          : Response.json({ reactionCount: 1, reacted: true })
      }),
    )
    renderApp()

    fireEvent.click(await screen.findByRole('button', { name: 'Like' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please try again',
    )
    expect(screen.getByText('0 likes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Like' }))
    expect(await screen.findByRole('button', { name: 'Liked' })).toBeEnabled()
    expect(screen.getByText('1 like')).toBeInTheDocument()
  })

  it('paginates across older meals and has an honest empty state', async () => {
    vi.mocked(auth.loadSession).mockResolvedValue(signedInSession)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const page = new URL(request.url).searchParams.get('page')
        return Response.json({
          items: page === '0' ? [meal] : [],
          hasMore: page === '0',
        })
      }),
    )
    renderApp()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Older meals' }))
    expect(await screen.findByText('No older meals.')).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Older meals' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Newer meals' }))
    expect(await screen.findByRole('article')).toBeInTheDocument()
  })

  it('recovers public competition loading without exposing a feed to visitors', async () => {
    let available = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        expect(request.url).toMatch(/\/competitions\?scope=public&page=0$/)
        return available
          ? Response.json({ items: [], hasMore: false })
          : Response.json({ error: 'UNAVAILABLE' }, { status: 503 })
      }),
    )
    renderApp()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    available = true
    fireEvent.click(
      screen.getByRole('button', { name: 'Try competitions again' }),
    )
    expect(
      await screen.findByText(
        'No public competitions yet. Sign in to start your own.',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  it('does not request meal data while the session is unavailable', async () => {
    vi.mocked(auth.loadSession).mockRejectedValue(
      new Error('Account unavailable'),
    )
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    renderApp()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Account unavailable',
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: 'Like' }),
    ).not.toBeInTheDocument()
  })

  it('provides a real not-found screen for unimplemented routes', () => {
    renderApp('/not-a-page')
    expect(
      screen.getByRole('heading', { name: 'This spot is not on the menu.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back home' })).toHaveAttribute(
      'href',
      '/',
    )
  })
})
