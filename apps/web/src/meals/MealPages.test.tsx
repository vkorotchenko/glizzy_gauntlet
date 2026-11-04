import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { Meal, Save } from './api'

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

describe('meal screens', () => {
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
      const input = await screen.findByLabelText('When you ate')
      expect(input).toHaveAttribute('step', '60')
      expect(
        screen.queryByLabelText('Eating time zone'),
      ).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Repeated hour')).not.toBeInTheDocument()
      fireEvent.change(input, { target: { value: local } })
      fireEvent.blur(input)
      expect((input as HTMLInputElement).value).toMatch(/T\d{2}:(00|15|30|45)$/)
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
    fireEvent.change(await screen.findByLabelText('When you ate'), {
      target: { value: '2026-10-28T12:09' },
    })
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
    const time = await screen.findByLabelText('When you ate')
    expect(time).toHaveValue('2026-11-01T01:07')
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

  it('requires explicit target selection and retries the same payload with one idempotency key', async () => {
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
    const time = await screen.findByLabelText('When you ate')
    expect(time).toHaveValue('')
    fireEvent.change(await screen.findByLabelText('How many hot dogs?'), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText('Total inches'), {
      target: { value: '19' },
    })
    const target = await screen.findByRole('checkbox', {
      name: 'Submit to Shared crew',
    })
    expect(target).not.toBeChecked()
    fireEvent.click(target)
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
        items: [],
        totalHundredths: 1900,
        wholeHotDogs: 2,
        location: '',
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
    fireEvent.change(await screen.findByLabelText('Total inches'), {
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

  it('keeps existing submissions unchecked and does not imply that private edits withdraw snapshots', async () => {
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
    expect(
      await screen.findByRole('checkbox', { name: 'Submit to Shared crew' }),
    ).not.toBeChecked()
    expect(
      screen.getByText(/Closed and unselected submissions keep their original/),
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

  it('browses venue and target pages without saving the filled meal form', async () => {
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
    await screen.findByLabelText('Total inches')
    fireEvent.click(
      screen.getByText('Add photos, location, time, or notes (optional)'),
    )
    await screen.findAllByRole('checkbox', { name: 'Submit to Shared crew' })
    for (const button of screen.getAllByRole('button', { name: 'Next page' }))
      fireEvent.click(button)
    await waitFor(() => expect(screen.getAllByText('Page 2')).toHaveLength(2))
    expect(
      fetch.mock.calls.filter(([request]) => request.method !== 'GET'),
    ).toHaveLength(0)
    expect(screen.getByLabelText('Total inches')).toHaveValue('19.00')
  })

  it.each([
    ['COUNT', true, false],
    ['LENGTH', false, true],
    ['BOTH', true, true],
  ] as const)(
    'shows and saves only the measurements needed for %s competitions',
    async (trackingMode, count, length) => {
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
      await screen.findByRole('checkbox', { name: 'Submit to Shared crew' })
      expect(Boolean(screen.queryByLabelText('How many hot dogs?'))).toBe(count)
      expect(Boolean(screen.queryByLabelText('Total inches'))).toBe(length)
      if (count)
        fireEvent.change(screen.getByLabelText('How many hot dogs?'), {
          target: { value: '3' },
        })
      if (length)
        fireEvent.change(screen.getByLabelText('Total inches'), {
          target: { value: '18.25' },
        })
      expect(screen.getByLabelText('When you ate')).not.toBeRequired()
      expect(screen.getByLabelText('Private location label')).not.toBeRequired()
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Save meal and selected submissions',
        }),
      )
      await waitFor(() => expect(saved).toBeDefined())
      expect(saved?.content).toMatchObject({
        items: [],
        totalHundredths: length ? 1825 : 0,
        wholeHotDogs: count ? 3 : 0,
        location: '',
        photoIds: [],
      })
      expect(saved?.content).not.toHaveProperty('eatenAt')
      expect(saved?.competitionIds).toEqual([])
    },
  )

  it('unions measurements across all membership pages, not only selected targets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
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
    expect(await screen.findByText('0 selected')).toBeVisible()
    expect(screen.getByLabelText('How many hot dogs?')).toBeInTheDocument()
    expect(screen.getByLabelText('Total inches')).toBeInTheDocument()
    expect(
      screen.getAllByRole('checkbox', { name: 'Submit to Shared crew' }),
    ).toHaveLength(2)
  })
})
