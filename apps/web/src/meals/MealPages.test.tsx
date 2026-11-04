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
import type { Venue } from '../directory/api'
import type { Meal, Save } from './api'

vi.mock('../directory/VenueMap', () => ({
  default: ({
    venues,
    selectedId,
    onSelect,
  }: {
    venues: Venue[]
    selectedId?: string
    onSelect?: (venue: Venue) => void
  }) => (
    <div role="region" aria-label="Approved venue map">
      {venues.map((venue) => (
        <button
          key={venue.id}
          type="button"
          aria-pressed={venue.id === selectedId}
          onClick={() => onSelect?.(venue)}
        >
          Select {venue.name}
        </button>
      ))}
    </div>
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
const competition = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Shared crew',
  rules: 'Use measured lengths.',
  visibility: 'PRIVATE',
  timeZone: 'UTC',
  startsAt: '2026-10-01T00:00:00Z',
  endsAt: '2026-11-01T00:00:00Z',
  submissionClosesAt: '2026-11-02T00:00:00Z',
  allowSharedMeals: true,
  trackingMode: 'BOTH',
  published: true,
  version: 1,
  phase: 'ACTIVE',
  viewerRole: 'MEMBER',
  canAdminister: false,
  memberCount: 2,
}
const meal: Meal = {
  id: '00000000-0000-4000-8000-000000000003',
  version: 1,
  archived: false,
  revision: {
    id: '00000000-0000-4000-8000-000000000004',
    version: 1,
    eatenAt: '2026-10-28T12:00:00Z',
    venueId: null,
    location: 'Kitchen',
    notes: '',
    items: [
      {
        name: 'House dog',
        wholeQuantity: 2,
        unitHundredths: 800,
        partialHundredths: 300,
        condiments: [],
      },
    ],
    photoIds: [],
    totalHundredths: 1900,
    wholeHotDogs: 2,
  },
  submissions: [],
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
function reply(request: Request) {
  if (request.url.endsWith('/auth/session')) return Response.json(session)
  if (request.url.endsWith('/meal-photos')) return Response.json([])
  if (request.url.includes('/competitions?'))
    return Response.json({ items: [competition], hasMore: false })
  if (request.url.includes('/venues?') || request.url.includes('/history?'))
    return Response.json({ items: [], hasMore: false })
  return Response.json(meal)
}

function useLocalZone(timeZone: string) {
  const options = new Intl.DateTimeFormat().resolvedOptions()
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    ...options,
    timeZone,
  })
}

async function enterMealTime(local: string) {
  fireEvent.change(await screen.findByLabelText('Meal date'), {
    target: { value: local.slice(0, 10) },
  })
  const time = screen.getByLabelText('Meal time')
  fireEvent.change(time, { target: { value: local.slice(11, 16) } })
  return time
}

async function customizeSharing() {
  fireEvent.click(
    await screen.findByRole('checkbox', {
      name: 'Share with all eligible competitions',
    }),
  )
}

describe('meal screens', () => {
  it('renders personal meals once with the shared feed photos, profile picture, and full meal details', async () => {
    const submission: Meal['submissions'][number] = {
      competitionId: competition.id,
      competitionName: competition.name,
      revisionId: meal.revision.id,
      totalHundredths: 1900,
      wholeHotDogs: 2,
      withdrawn: false,
      scoreExcluded: false,
      version: 1,
      acceptsChanges: true,
    }
    const saved: Meal = {
      ...meal,
      revision: {
        ...meal.revision,
        photoIds: ['first-photo', 'second-photo', 'third-photo'],
        notes: 'Lunch with the crew.',
        items: [{ ...meal.revision.items[0], condiments: ['Mustard'] }],
      },
      submissions: [
        submission,
        { ...submission, competitionId: 'another-competition' },
        {
          ...submission,
          competitionId: 'withdrawn-competition',
          withdrawn: true,
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) =>
        request.url.endsWith('/auth/session')
          ? Response.json({
              ...session,
              user: { ...session.user, profilePhotoId: 'profile-picture' },
            })
          : Response.json({ items: [saved], hasMore: false }),
      ),
    )
    show('/account/meals')
    const card = within(
      await screen.findByRole('article', { name: "Fan's meal" }),
    )
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(card.getByRole('heading', { name: 'Fan' })).toBeVisible()
    expect(
      card.getByRole('img', { name: "Fan's profile picture" }),
    ).toHaveAttribute(
      'src',
      '/api/v1/profile-photos/profile-picture?thumbnail=true',
    )
    for (const [index, id] of saved.revision.photoIds.entries()) {
      const photo = card.getByRole('img', { name: `Meal photo ${index + 1}` })
      expect(photo).toHaveAttribute(
        'src',
        `/api/v1/meal-photos/${id}?thumbnail=true`,
      )
      expect(photo.closest('a')).toHaveAttribute(
        'href',
        `/api/v1/meal-photos/${id}?thumbnail=false`,
      )
    }
    expect(card.getByRole('link', { name: 'House dog' })).toHaveAttribute(
      'href',
      `/meals/${meal.id}`,
    )
    expect(card.getByText('Mustard')).toBeVisible()
    expect(card.getByText('Lunch with the crew.')).toBeVisible()
    expect(card.getByText(/Kitchen/)).toBeVisible()
    expect(card.getByText('2 competition submissions')).toBeVisible()
    const totals = within(
      card.getByRole('group', { name: 'Meal totals and likes' }),
    )
    expect(totals.getByText('2 hot dogs')).toBeVisible()
    expect(totals.getByText('19.00 inches')).toBeVisible()
  })

  it('preserves personal feed pagination, archive selection, and cards without pictures', async () => {
    const requests: { archived: string | null; page: string | null }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/auth/session')) return Response.json(session)
        const query = new URL(request.url).searchParams
        requests.push({
          archived: query.get('archived'),
          page: query.get('page'),
        })
        const archived = query.get('archived') === 'true'
        return Response.json({
          items: [
            {
              ...meal,
              archived,
              revision: {
                ...meal.revision,
                photoIds: archived ? ['archived-photo'] : [],
                notes: archived
                  ? 'Archived lunch.'
                  : `Page ${query.get('page')} lunch.`,
              },
            },
          ],
          hasMore: !archived && query.get('page') === '0',
        })
      }),
    )
    show('/account/meals')
    let card = within(
      await screen.findByRole('article', { name: "Fan's meal" }),
    )
    expect(card.queryByRole('img')).not.toBeInTheDocument()
    expect(card.getByText('F')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Page 1 lunch.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Show archived sources' }),
    )
    expect(await screen.findByText('Archived lunch.')).toBeVisible()
    card = within(screen.getByRole('article', { name: "Fan's meal" }))
    expect(card.getByRole('img', { name: 'Meal photo 1' })).toHaveAttribute(
      'src',
      '/api/v1/meal-photos/archived-photo?thumbnail=true',
    )
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(requests).toEqual([
      { archived: 'false', page: '0' },
      { archived: 'false', page: '1' },
      { archived: 'true', page: '0' },
    ])
  })

  it.each([
    ['UTC', '2026-10-28T12:07', '2026-10-28T12:00:00Z'],
    ['UTC', '2026-10-28T12:08', '2026-10-28T12:15:00Z'],
    ['UTC', '2026-10-28T12:53', '2026-10-28T13:00:00Z'],
    ['UTC', '2026-10-27T23:53', '2026-10-28T00:00:00Z'],
    ['America/New_York', '2026-03-08T01:53', '2026-03-08T07:00:00Z'],
  ])(
    'rounds %s local time %s to a quarter-hour meal timestamp',
    async (zone, local, expected) => {
      useLocalZone(zone)
      let body: Save | undefined
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: Request) => {
          if (request.method === 'PUT') {
            body = (await request.json()) as Save
            return Response.json(meal)
          }
          return reply(request)
        }),
      )
      show(`/meals/${meal.id}/edit`)
      const input = await enterMealTime(local)
      expect(input).toHaveAttribute('step', '60')
      expect(input).toHaveAttribute('type', 'time')
      expect(screen.getByLabelText('Meal date')).toHaveAttribute('type', 'date')
      expect(
        screen.queryByLabelText('Eating time zone'),
      ).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Repeated hour')).not.toBeInTheDocument()
      fireEvent.blur(input)
      expect((input as HTMLInputElement).value).toMatch(/^\d{2}:(00|15|30|45)$/)
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Save meal and selected submissions',
        }),
      )
      await waitFor(() => expect(body?.content.eatenAt).toBe(expected))
    },
  )

  it('does not round a current meal into the future, including on direct submission', async () => {
    useLocalZone('UTC')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-28T12:10:00Z'))
    let body: Save | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'PUT') {
          body = (await request.json()) as Save
          return Response.json(meal)
        }
        return reply(request)
      }),
    )
    show(`/meals/${meal.id}/edit`)
    await enterMealTime('2026-10-28T12:09')
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    await waitFor(() =>
      expect(body?.content.eatenAt).toBe('2026-10-28T12:00:00Z'),
    )
  })

  it('preserves a stored precise second-occurrence timestamp when only notes change', async () => {
    useLocalZone('America/New_York')
    const precise = {
      ...meal,
      revision: { ...meal.revision, eatenAt: '2026-11-01T06:07:43.123Z' },
    }
    let body: Save | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'PUT') {
          body = (await request.json()) as Save
          return Response.json(precise)
        }
        if (request.url.endsWith(`/meals/${meal.id}`))
          return Response.json(precise)
        return reply(request)
      }),
    )
    show(`/meals/${meal.id}/edit`)
    const time = await screen.findByLabelText('Meal time')
    expect(time).toHaveValue('01:07')
    expect(screen.getByLabelText('Meal date')).toHaveValue('2026-11-01')
    fireEvent.blur(time)
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'Updated notes' },
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    await waitFor(() =>
      expect(body?.content.eatenAt).toBe(precise.revision.eatenAt),
    )
    expect(body?.content.notes).toBe('Updated notes')
    expect(body?.content.items).toEqual(meal.revision.items)
    expect(body?.content).not.toHaveProperty('totalHundredths')
  })

  it('defaults to all eligible targets and retries the same payload with one idempotency key', async () => {
    const saved: Save[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'POST' && request.url.endsWith('/meals')) {
          expect(request.headers.get('X-CSRF-TOKEN')).toBe('test-csrf')
          saved.push((await request.json()) as Save)
          return saved.length === 1
            ? Response.json(
                { error: 'API_UNAVAILABLE', competitionId: null },
                { status: 503 },
              )
            : Response.json(meal, { status: 201 })
        }
        return reply(request)
      }),
    )
    show('/meals/new')
    const time = await screen.findByLabelText('Meal time')
    expect(time).toHaveValue('')
    expect(screen.getByLabelText('Meal date')).toHaveValue('')
    fireEvent.change(await screen.findByLabelText('Inches for hot dog 1'), {
      target: { value: '9.5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate hot dog 1' }))
    const target = await screen.findByRole('checkbox', {
      name: 'Share with all eligible competitions',
    })
    expect(target).toBeChecked()
    expect(
      screen.queryByRole('group', { name: 'Choose competitions' }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request failed',
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Meal record' }),
    ).toBeVisible()
    expect(saved).toHaveLength(2)
    expect(saved[0]).toEqual(saved[1])
    expect(saved[0]).toMatchObject({
      version: 0,
      competitionIds: [competition.id],
      content: {
        items: Array.from({ length: 2 }, () => ({
          name: 'Hotdog',
          wholeQuantity: 1,
          unitHundredths: 950,
          partialHundredths: 0,
          condiments: [],
        })),
        location: 'Home',
        photoIds: [],
      },
    })
    expect(saved[0].content).not.toHaveProperty('eatenAt')
    expect(screen.getByText('19.00 inches')).toBeVisible()
  })

  it('rejects excessive decimal precision before sending a scoring request', async () => {
    const fetch = vi.fn(async (request: Request) => reply(request))
    vi.stubGlobal('fetch', fetch)
    show(`/meals/${meal.id}/edit`)
    fireEvent.change(await screen.findByLabelText('Inches for hot dog 1'), {
      target: { value: '8.001' },
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'at most two decimal places',
    )
    expect(fetch.mock.calls.some(([request]) => request.method === 'PUT')).toBe(
      false,
    )
  })

  it('allows private edits without withdrawing previously shared snapshots', async () => {
    let body: Save | undefined
    const existing = {
      ...meal,
      submissions: [
        {
          competitionId: competition.id,
          competitionName: competition.name,
          revisionId: meal.revision.id,
          totalHundredths: 1900,
          wholeHotDogs: 2,
          withdrawn: false,
          scoreExcluded: false,
          version: 1,
          acceptsChanges: false,
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'PUT') {
          body = (await request.json()) as Save
          return Response.json(existing)
        }
        if (request.url.endsWith(`/meals/${meal.id}`))
          return Response.json(existing)
        return reply(request)
      }),
    )
    show(`/meals/${meal.id}/edit`)
    await customizeSharing()
    expect(
      await screen.findByRole('checkbox', { name: 'Submit to Shared crew' }),
    ).not.toBeChecked()
    expect(
      screen.getByText(/Closed and unselected submissions stay unchanged/),
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    await waitFor(() => expect(body?.competitionIds).toEqual([]))
    expect(
      await screen.findByRole('heading', { name: 'Meal record' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Withdraw from Shared crew' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/This does not withdraw any competition submission/),
    ).toBeVisible()
  })

  it('shows venue choices without pagination and keeps custom target pagination out of form submission', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (
        request.url.includes('/venues?') ||
        request.url.includes('/competitions?')
      )
        return Response.json({
          items: request.url.includes('/competitions?')
            ? new URL(request.url).searchParams.get('page') === '0'
              ? Array.from({ length: 20 }, (_, index) => ({
                  ...competition,
                  id: `crew-${index}`,
                }))
              : [{ ...competition, id: 'crew-last' }]
            : [],
          hasMore: new URL(request.url).searchParams.get('page') === '0',
        })
      if (request.method === 'PUT')
        return Response.json({ error: 'API_UNAVAILABLE' }, { status: 503 })
      return reply(request)
    })
    vi.stubGlobal('fetch', fetch)
    show(`/meals/${meal.id}/edit`)
    await screen.findByLabelText('Inches for hot dog 1')
    await screen.findByRole('group', { name: 'Approved venue (optional)' })
    await screen.findByText('21 selected')
    expect(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    ).toBeDisabled()
    await customizeSharing()
    await screen.findAllByRole('checkbox', { name: 'Submit to Shared crew' })
    expect(
      within(
        screen.getByRole('group', { name: 'Approved venue (optional)' }),
      ).queryByRole('button', { name: 'Next page' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Page 2')
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Submit to Shared crew' }),
    )
    expect(screen.getByText('1 selected')).toBeVisible()
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Share with all eligible competitions',
      }),
    )
    expect(
      screen.queryByRole('group', { name: 'Choose competitions' }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Share with all eligible competitions',
      }),
    )
    expect(
      screen.getByRole('checkbox', { name: 'Submit to Shared crew' }),
    ).toBeChecked()
    expect(
      fetch.mock.calls.filter(([request]) => request.method !== 'GET'),
    ).toHaveLength(0)
    expect(screen.getByLabelText('Inches for hot dog 1')).toHaveValue('8.00')
  })

  it.each([
    ['COUNT', false],
    ['LENGTH', true],
    ['BOTH', true],
  ] as const)(
    'shows inches for %s competitions and derives counts from rows',
    async (trackingMode, length) => {
      let saved: Save | undefined
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: Request) => {
          if (request.url.includes('/competitions?'))
            return Response.json({
              items: [{ ...competition, trackingMode }],
              hasMore: false,
            })
          if (request.method === 'POST' && request.url.endsWith('/meals')) {
            saved = (await request.json()) as Save
            return Response.json(meal, { status: 201 })
          }
          return reply(request)
        }),
      )
      show('/meals/new')
      await screen.findByText('1 selected')
      expect(
        screen.queryByLabelText('How many hot dogs?'),
      ).not.toBeInTheDocument()
      expect(Boolean(screen.queryByLabelText('Inches for hot dog 1'))).toBe(
        length,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Add hot dog' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add hot dog' }))
      if (length)
        fireEvent.change(screen.getByLabelText('Inches for hot dog 1'), {
          target: { value: '18.25' },
        })
      expect(screen.getByLabelText('Meal date')).not.toBeRequired()
      expect(screen.getByLabelText('Meal time')).not.toBeRequired()
      expect(screen.getByRole('radio', { name: 'Home' })).toBeChecked()
      expect(
        screen.queryByLabelText('Private location label'),
      ).not.toBeInTheDocument()
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Save meal and selected submissions',
        }),
      )
      await waitFor(() => expect(saved).toBeDefined())
      expect(saved?.content).toMatchObject({
        items: [
          {
            name: 'Hotdog',
            wholeQuantity: 1,
            unitHundredths: length ? 1825 : 0,
            partialHundredths: 0,
            condiments: [],
          },
          {
            name: 'Hotdog',
            wholeQuantity: 1,
            unitHundredths: 0,
            partialHundredths: 0,
            condiments: [],
          },
          {
            name: 'Hotdog',
            wholeQuantity: 1,
            unitHundredths: 0,
            partialHundredths: 0,
            condiments: [],
          },
        ],
        location: 'Home',
        photoIds: [],
      })
      expect(saved?.content).not.toHaveProperty('eatenAt')
      expect(saved?.competitionIds).toEqual([competition.id])
    },
  )

  it('unions measurements across all membership pages, not only selected targets', async () => {
    let saved: Save | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'POST' && request.url.endsWith('/meals')) {
          saved = (await request.json()) as Save
          return Response.json(meal, { status: 201 })
        }
        if (request.url.includes('/competitions?')) {
          const page = new URL(request.url).searchParams.get('page')
          return Response.json({
            items: [
              {
                ...competition,
                id: `crew-${page}`,
                trackingMode: page === '0' ? 'COUNT' : 'LENGTH',
              },
            ],
            hasMore: page === '0',
          })
        }
        return reply(request)
      }),
    )
    show('/meals/new')
    expect(await screen.findByText('2 selected')).toBeVisible()
    expect(
      screen.getByLabelText('Description for hot dog 1'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Inches for hot dog 1')).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: 'Submit to Shared crew' }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Inches for hot dog 1'), {
      target: { value: '8' },
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    await waitFor(() =>
      expect(saved?.competitionIds).toEqual(['crew-0', 'crew-1']),
    )
  })

  it('previews, duplicates, and saves descriptions and multiple condiments independently', async () => {
    let saved: Save | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'POST' && request.url.endsWith('/meals')) {
          saved = (await request.json()) as Save
          return Response.json(meal, { status: 201 })
        }
        return reply(request)
      }),
    )
    show('/meals/new')
    const description = await screen.findByLabelText(
      'Description for hot dog 1',
    )
    expect(description).toHaveAttribute('placeholder', 'hotdog')
    expect(
      screen.getAllByRole('button', { name: /Duplicate hot dog/ }),
    ).toHaveLength(1)
    fireEvent.change(description, { target: { value: 'Ballpark dog' } })
    fireEvent.change(await screen.findByLabelText('Inches for hot dog 1'), {
      target: { value: '7.25' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Condiments for hot dog 1' }),
    )
    const dialog = screen.getByRole('dialog', {
      name: 'Condiments for hot dog 1',
    })
    fireEvent.click(within(dialog).getByLabelText('Mustard'))
    fireEvent.click(within(dialog).getByLabelText('Onions'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate hot dog 1' }))
    fireEvent.change(screen.getByLabelText('Description for hot dog 2'), {
      target: { value: 'Second dog' },
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Condiments for hot dog 2 (2 selected)',
      }),
    )
    fireEvent.click(screen.getByLabelText('Onions'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    const preview = within(
      screen.getByRole('article', { name: 'Meal preview' }),
    )
    expect(preview.getByText('Ballpark dog')).toBeVisible()
    expect(preview.getByText('Mustard, Onions')).toBeVisible()
    expect(preview.getByText('14.50 inches')).toBeVisible()
    expect(preview.getByText('2 hot dogs')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Add hot dog' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove hot dog 3' }))
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    await waitFor(() =>
      expect(saved?.content.items).toEqual([
        {
          name: 'Ballpark dog',
          wholeQuantity: 1,
          unitHundredths: 725,
          partialHundredths: 0,
          condiments: ['Mustard', 'Onions'],
        },
        {
          name: 'Second dog',
          wholeQuantity: 1,
          unitHundredths: 725,
          partialHundredths: 0,
          condiments: ['Mustard'],
        },
      ]),
    )
    expect(saved?.content).not.toHaveProperty('totalHundredths')
  })

  it('keeps long sharing guidance in an info popup without submitting the form', async () => {
    const fetch = vi.fn(async (request: Request) => reply(request))
    vi.stubGlobal('fetch', fetch)
    show('/meals/new')
    const info = await screen.findByRole('button', {
      name: 'About competition sharing',
    })
    expect(
      screen.queryByText(/removing a checkmark does not withdraw/),
    ).not.toBeInTheDocument()
    fireEvent.click(info)
    const dialog = screen.getByRole('dialog', {
      name: 'About competition sharing',
    })
    expect(
      within(dialog).getByText(/removing a checkmark does not withdraw/),
    ).toBeVisible()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      fetch.mock.calls.every(([request]) => request.method === 'GET'),
    ).toBe(true)
    expect(screen.getByLabelText('Meal date')).toBeVisible()
    expect(screen.getByLabelText('Meal time')).toBeVisible()
  })

  it('uploads dropped and chosen photos into the preview and rejects a fourth photo before uploading', async () => {
    let uploads = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'POST' && request.url.endsWith('/meal-photos'))
          return Response.json({ id: `photo-${++uploads}` }, { status: 201 })
        return reply(request)
      }),
    )
    show('/meals/new')
    const dropzone = await screen.findByRole('button', {
      name: 'Add meal photos: choose or drag and drop',
    })
    const file = (name: string) =>
      new File(['image'], name, { type: 'image/png' })
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file('one.png'), file('two.png')] },
    })
    expect(
      await screen.findByRole('img', { name: 'Meal preview photo 2' }),
    ).toHaveAttribute('src', '/api/v1/meal-photos/photo-2?thumbnail=true')
    await waitFor(() =>
      expect(screen.getByLabelText('Add photos (up to 3)')).not.toBeDisabled(),
    )
    fireEvent.change(screen.getByLabelText('Add photos (up to 3)'), {
      target: { files: [file('three.png')] },
    })
    await screen.findByRole('img', { name: 'Meal preview photo 3' })
    await waitFor(() =>
      expect(screen.getByLabelText('Add photos (up to 3)')).toBeDisabled(),
    )
    fireEvent.drop(dropzone, { dataTransfer: { files: [file('four.png')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'at most 3 photos',
    )
    expect(uploads).toBe(3)
    fireEvent.click(screen.getByLabelText('Attach photo 2'))
    expect(
      screen.queryByRole('img', { name: 'Meal preview photo 3' }),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Add photos (up to 3)')).not.toBeDisabled()
  })

  it('blocks saving during photo upload and leaves failed uploads out of the selected photos', async () => {
    let complete: ((response: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'POST' && request.url.endsWith('/meal-photos'))
          return new Promise<Response>((resolve) => {
            complete = resolve
          })
        return reply(request)
      }),
    )
    show('/meals/new')
    await screen.findByText('1 selected')
    fireEvent.change(screen.getByLabelText('Add photos (up to 3)'), {
      target: {
        files: [new File(['image'], 'meal.png', { type: 'image/png' })],
      },
    })
    const save = screen.getByRole('button', {
      name: 'Save meal and selected submissions',
    })
    await waitFor(() => expect(save).toBeDisabled())
    await waitFor(() => expect(complete).toBeDefined())
    complete!(Response.json({ error: 'INVALID_IMAGE' }, { status: 400 }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'valid JPEG or PNG',
    )
    await waitFor(() => expect(save).not.toBeDisabled())
    expect(
      screen.queryByRole('img', { name: 'Meal preview photo 1' }),
    ).not.toBeInTheDocument()
  })

  it('preserves older aggregate totals until explicitly replaced with rows', async () => {
    const aggregate = {
      ...meal,
      revision: {
        ...meal.revision,
        items: [],
        totalHundredths: 1825,
        wholeHotDogs: 3,
      },
    }
    let saved: Save | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'PUT') {
          saved = (await request.json()) as Save
          return Response.json(aggregate)
        }
        if (request.url.endsWith(`/meals/${meal.id}`))
          return Response.json(aggregate)
        return reply(request)
      }),
    )
    show(`/meals/${meal.id}/edit`)
    expect(await screen.findByLabelText('Total inches')).toHaveValue('18.25')
    fireEvent.click(screen.getByText('Notes (optional)'))
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'No measurement change' },
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    await waitFor(() =>
      expect(saved?.content).toMatchObject({
        items: [],
        totalHundredths: 1825,
        wholeHotDogs: 3,
      }),
    )
  })

  it('sorts venues from every page by proximity only after requesting location permission', async () => {
    let saved: Save | undefined
    const far = {
      id: 'far',
      name: 'A distant stand',
      address: 'Far street',
      latitude: 0,
      longitude: 0,
    }
    const near = {
      id: 'near',
      name: 'Z nearby stand',
      address: 'Near street',
      latitude: 0,
      longitude: 179.95,
    }
    const acrossDateLine = {
      id: 'west',
      name: 'M across the date line',
      address: 'West street',
      latitude: 0,
      longitude: -179.9,
    }
    const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>(
      (success) =>
        success({
          coords: { latitude: 0, longitude: 179.9 },
        } as GeolocationPosition),
    )
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.includes('/venues?'))
        return Response.json(
          new URL(request.url).searchParams.get('page') === '0'
            ? { items: [far], hasMore: true }
            : { items: [near, acrossDateLine], hasMore: false },
        )
      if (request.method === 'POST' && request.url.endsWith('/meals')) {
        saved = (await request.json()) as Save
        return Response.json(meal, { status: 201 })
      }
      return reply(request)
    })
    vi.stubGlobal('fetch', fetch)
    show('/meals/new')
    fireEvent.click(
      await screen.findByRole('radio', { name: 'Somewhere else' }),
    )
    await screen.findByRole('radio', { name: /Z nearby stand/ })
    const choices = () =>
      within(screen.getByRole('group', { name: 'Approved venue (optional)' }))
        .getAllByRole('radio')
        .slice(1)
        .map((input) => input.closest('label')!.textContent)
    expect(choices()[0]).toContain(far.name)
    expect(getCurrentPosition).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(getCurrentPosition).toHaveBeenCalledOnce()
    expect(choices()[0]).toContain(near.name)
    expect(choices()[1]).toContain(acrossDateLine.name)
    fireEvent.click(screen.getByRole('radio', { name: /Z nearby stand/ }))
    expect(
      within(screen.getByRole('article', { name: 'Meal preview' })).getByText(
        /Z nearby stand \/ Near street/,
      ),
    ).toBeVisible()
    fireEvent.change(screen.getByLabelText('Find a venue'), {
      target: { value: 'Far street' },
    })
    expect(
      screen.queryByRole('radio', { name: /M across/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Z nearby stand/ })).toBeChecked()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    await waitFor(() =>
      expect(saved?.content).toMatchObject({ venueId: near.id, location: '' }),
    )
    expect(saved?.content).not.toHaveProperty('latitude')
    expect(
      fetch.mock.calls.every(
        ([request]) => !/latitude|longitude/.test(request.url),
      ),
    ).toBe(true)
  })

  it.each(['denied', 'unsupported'])(
    'keeps venue selection usable when geolocation is %s',
    async (availability) => {
      const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>(
        (_, fail) =>
          fail?.({
            code: 1,
          } as GeolocationPositionError),
      )
      vi.stubGlobal(
        'navigator',
        availability === 'denied'
          ? { geolocation: { getCurrentPosition } }
          : {},
      )
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: Request) =>
          request.url.includes('/venues?')
            ? Response.json({
                items: [
                  {
                    id: 'manual',
                    name: 'Manual stand',
                    address: 'Main street',
                    latitude: 1,
                    longitude: 2,
                  },
                ],
                hasMore: false,
              })
            : reply(request),
        ),
      )
      show('/meals/new')
      fireEvent.click(
        await screen.findByRole('radio', { name: 'Somewhere else' }),
      )
      const manual = await screen.findByRole('radio', { name: /Manual stand/ })
      fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))
      expect(
        screen.getByText(
          availability === 'denied'
            ? /permission was denied/
            : /unavailable in this browser/,
        ),
      ).toBeVisible()
      fireEvent.click(manual)
      expect(manual).toBeChecked()
      fireEvent.click(
        screen.getByRole('radio', {
          name: 'No venue / private location label',
        }),
      )
      expect(screen.getByLabelText('Private location label')).toBeVisible()
    },
  )

  it('defaults to Home and retains a selected venue across list, map, and Home switches', async () => {
    const venue: Venue = {
      id: 'map-venue',
      revision: 'map-revision',
      name: 'Map stand',
      address: 'Main street',
      description: '',
      latitude: 40,
      longitude: -74,
      menuItems: [],
      photos: [],
    }
    let saved: Save | undefined
    const getCurrentPosition = vi.fn()
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.includes('/venues?'))
        return Response.json({ items: [venue], hasMore: false })
      if (request.method === 'POST' && request.url.endsWith('/meals')) {
        saved = (await request.json()) as Save
        return Response.json(meal, { status: 201 })
      }
      return reply(request)
    })
    vi.stubGlobal('fetch', fetch)
    show('/meals/new')
    fireEvent.change(await screen.findByLabelText('Inches for hot dog 1'), {
      target: { value: '8' },
    })
    expect(screen.getByRole('radio', { name: 'Home' })).toBeChecked()
    expect(
      screen.queryByRole('group', { name: 'Approved venue (optional)' }),
    ).not.toBeInTheDocument()
    expect(
      fetch.mock.calls.some(([request]) => request.url.includes('/venues?')),
    ).toBe(false)
    const preview = within(
      screen.getByRole('article', { name: 'Meal preview' }),
    )
    expect(preview.getByText(/ \/ Home$/)).toBeVisible()
    fireEvent.click(screen.getByRole('radio', { name: 'Somewhere else' }))
    await screen.findByRole('radio', { name: /Map stand/ })
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      screen.queryByRole('region', { name: 'Approved venue map' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select Map stand' }),
    )
    expect(preview.getByText(/Map stand \/ Main street/)).toBeVisible()
    expect(
      fetch.mock.calls.every(([request]) => request.method === 'GET'),
    ).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'Home' }))
    expect(preview.getByText(/ \/ Home$/)).toBeVisible()
    expect(
      screen.queryByRole('group', { name: 'Approved venue (optional)' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Somewhere else' }))
    expect(screen.getByRole('radio', { name: /Map stand/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    expect(
      await screen.findByRole('button', { name: 'Select Map stand' }),
    ).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByRole('radio', { name: /Map stand/ })).toBeChecked()
    expect(getCurrentPosition).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    await waitFor(() =>
      expect(saved?.content).toMatchObject({ venueId: venue.id, location: '' }),
    )
  })

  it('saves Home without sending a previously selected venue', async () => {
    const existing = {
      ...meal,
      revision: {
        ...meal.revision,
        venueId: 'old-venue',
        location: 'Old stand',
      },
    }
    let saved: Save | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'PUT') {
          saved = (await request.json()) as Save
          return Response.json(existing)
        }
        if (request.url.endsWith(`/meals/${meal.id}`))
          return Response.json(existing)
        return reply(request)
      }),
    )
    show(`/meals/${meal.id}/edit`)
    expect(
      await screen.findByRole('radio', { name: 'Somewhere else' }),
    ).toBeChecked()
    expect(
      screen.getByRole('radio', { name: /Saved venue: Old stand/ }),
    ).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Home' }))
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    await waitFor(() =>
      expect(saved?.content).toMatchObject({ venueId: null, location: 'Home' }),
    )
  })

  it.each(['', 'home', 'Kitchen'])(
    'preserves an existing location %j when editing notes',
    async (location) => {
      const existing = {
        ...meal,
        revision: { ...meal.revision, location },
      }
      let saved: Save | undefined
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: Request) => {
          if (request.method === 'PUT') {
            saved = (await request.json()) as Save
            return Response.json(existing)
          }
          if (request.url.endsWith(`/meals/${meal.id}`))
            return Response.json(existing)
          return reply(request)
        }),
      )
      show(`/meals/${meal.id}/edit`)
      const isHome = location === 'home'
      expect(
        await screen.findByRole('radio', {
          name: isHome ? 'Home' : 'Somewhere else',
        }),
      ).toBeChecked()
      fireEvent.click(screen.getByText('Notes (optional)'))
      fireEvent.change(screen.getByLabelText('Notes'), {
        target: { value: 'Updated notes' },
      })
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Save meal and selected submissions',
        }),
      )
      await waitFor(() =>
        expect(saved?.content).toMatchObject({
          venueId: null,
          location,
          notes: 'Updated notes',
        }),
      )
    },
  )

  it.each([
    ['Meal date', '2026-10-28'],
    ['Meal time', '12:00'],
  ])(
    'requires both date and time when only %s is entered',
    async (label, value) => {
      const fetch = vi.fn(async (request: Request) => reply(request))
      vi.stubGlobal('fetch', fetch)
      show('/meals/new')
      fireEvent.change(await screen.findByLabelText(label), {
        target: { value },
      })
      await screen.findByText('1 selected')
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Save meal and selected submissions',
        }),
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Choose both a meal date and time',
      )
      expect(
        fetch.mock.calls.every(([request]) => request.method === 'GET'),
      ).toBe(true)
    },
  )

  it('clears both date and time to use the database save time', async () => {
    let saved: Save | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'PUT') {
          saved = (await request.json()) as Save
          return Response.json(meal)
        }
        return reply(request)
      }),
    )
    show(`/meals/${meal.id}/edit`)
    fireEvent.change(await screen.findByLabelText('Meal date'), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByLabelText('Meal time'), {
      target: { value: '' },
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save meal and selected submissions',
      }),
    )
    await waitFor(() => expect(saved).toBeDefined())
    expect(saved?.content).not.toHaveProperty('eatenAt')
  })
})
