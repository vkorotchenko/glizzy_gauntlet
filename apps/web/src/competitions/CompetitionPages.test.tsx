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
import type { Competition } from './api'

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Captain',
  siteOwner: false,
  roles: [],
  providers: ['email'],
}
const session = {
  user,
  csrfToken: 'test-csrf',
  csrfHeader: 'X-CSRF-TOKEN',
  emailEnabled: true,
  googleEnabled: false,
}
const competition: Competition = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Neighborhood crew',
  rules: 'Actual measurements; eat at your own pace.',
  visibility: 'PUBLIC',
  timeZone: 'America/New_York',
  startsAt: '2030-07-01T16:00:00Z',
  endsAt: '2030-07-02T16:00:00Z',
  submissionClosesAt: '2030-07-03T16:00:00Z',
  allowSharedMeals: false,
  trackingMode: 'BOTH',
  allTime: false,
  published: true,
  version: 1,
  phase: 'SCHEDULED',
  viewerRole: 'NONE',
  canAdminister: false,
  memberCount: 1,
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

describe('competition screens', () => {
  it('separates administered competitions and other memberships with independent pagination', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/auth/session')) return Response.json(session)
      const params = new URL(request.url).searchParams
      const administered = params.get('scope') === 'administered'
      const second = params.get('page') === '1'
      return Response.json({
        items: [
          {
            ...competition,
            id: administered ? (second ? 'older-draft' : 'all-time') : 'other',
            name: administered
              ? second
                ? 'Older draft'
                : 'All-time Glizzy Gauntlet'
              : 'Other crew',
            allTime: administered && !second,
            viewerRole: administered ? 'ORGANIZER' : 'MEMBER',
            canAdminister: administered,
          },
        ],
        hasMore: administered && !second,
      })
    })
    vi.stubGlobal('fetch', fetch)
    show('/account/competitions')
    const administered = await screen.findByRole('region', {
      name: 'Competitions I administer',
    })
    const participating = screen.getByRole('region', {
      name: 'Other competitions',
    })
    expect(
      await within(administered).findByRole('link', {
        name: 'All-time Glizzy Gauntlet',
      }),
    ).toBeVisible()
    expect(
      await within(participating).findByRole('link', { name: 'Other crew' }),
    ).toBeVisible()
    expect(
      within(participating).queryByRole('link', {
        name: 'All-time Glizzy Gauntlet',
      }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      within(administered).getByRole('button', { name: 'Next page' }),
    )
    expect(
      await within(administered).findByRole('link', { name: 'Older draft' }),
    ).toBeVisible()
    expect(
      within(participating).getByRole('link', { name: 'Other crew' }),
    ).toBeVisible()
    expect(
      fetch.mock.calls.filter(
        ([request]) =>
          new URL(request.url).searchParams.get('scope') === 'participating',
      ),
    ).toHaveLength(1)
  })

  it('shows all-time organizer tools while keeping lifetime settings locked', async () => {
    const lifetime = {
      ...competition,
      allTime: true,
      trackingMode: 'COUNT',
      phase: 'ACTIVE',
      endsAt: null,
      submissionClosesAt: null,
      viewerRole: 'ORGANIZER',
      canAdminister: true,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/auth/session')) return Response.json(session)
        if (/\/(members|standings|entries|meals)\?/.test(request.url))
          return Response.json({ items: [], hasMore: false, provisional: true })
        if (
          request.url.endsWith('/featured-venues') ||
          request.url.endsWith('/invitations') ||
          request.url.endsWith('/invitation-emails')
        )
          return Response.json([])
        return Response.json(lifetime)
      }),
    )
    show(`/competitions/${competition.id}`)
    expect(
      await screen.findByRole('button', { name: 'Create invitation' }),
    ).toBeEnabled()
    expect(
      screen.queryByRole('link', { name: 'Edit settings' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Competition recap' }),
    ).not.toBeInTheDocument()
  })

  it('shows an endless invitation without a misleading Unix-epoch date range', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) =>
        Response.json(
          request.url.endsWith('/auth/session')
            ? session
            : {
                competitionId: competition.id,
                name: 'All-time Glizzy Gauntlet',
                rules: competition.rules,
                timeZone: 'UTC',
                startsAt: '1970-01-01T00:00:00Z',
                endsAt: null,
                expiresAt: '2030-07-01T00:00:00Z',
                allowSharedMeals: true,
              },
        ),
      ),
    )
    show(`/join?token=${'a'.repeat(43)}`)
    expect(await screen.findByText('All time / No end date')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Accept invitation' }),
    ).toBeEnabled()
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument()
  })

  it('shows enrolled competitions above default public discovery with no scope buttons', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/auth/session')) return Response.json(session)
        const scope = new URL(request.url).searchParams.get('scope')
        return Response.json({
          items: [
            {
              ...competition,
              id: scope,
              name: scope === 'joined' ? 'Joined crew' : 'Public crew',
            },
          ],
          hasMore: false,
        })
      }),
    )
    show('/competitions')
    expect(
      await screen.findByRole('link', { name: 'Joined crew' }),
    ).toBeVisible()
    expect(
      await screen.findByRole('link', { name: 'Public crew' }),
    ).toBeVisible()
    const sections = screen.getAllByRole('region', {
      name: /My competitions|Public competitions/,
    })
    expect(sections[0]).toHaveAttribute(
      'aria-labelledby',
      'joined-competitions',
    )
    expect(
      within(sections[0]!).getByRole('link', { name: 'Joined crew' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', {
        name: /My competitions|Public competitions/,
      }),
    ).not.toBeInTheDocument()
  })

  it('lets an all-time member leave and explicitly rejoin without an end date or recap', async () => {
    let joined = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/auth/session')) return Response.json(session)
        if (request.method === 'POST') {
          expect(request.headers.get('X-CSRF-TOKEN')).toBe('test-csrf')
          joined = request.url.endsWith('/join')
        }
        if (/\/(members|standings|entries|meals)\?/.test(request.url))
          return Response.json({ items: [], hasMore: false, provisional: true })
        return Response.json({
          ...competition,
          allTime: true,
          trackingMode: 'COUNT',
          phase: 'ACTIVE',
          endsAt: null,
          submissionClosesAt: null,
          viewerRole: joined ? 'MEMBER' : 'NONE',
        })
      }),
    )
    show(`/competitions/${competition.id}`)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Leave all-time competition' }),
    )
    expect(
      await screen.findByRole('button', {
        name: 'Join competition',
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole('link', { name: 'Competition recap' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Join competition' }))
    expect(
      await screen.findByRole('button', { name: 'Leave all-time competition' }),
    ).toBeVisible()
  })

  it('does not request member details or expose organizer controls to public visitors', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/auth/session'))
        return Response.json({ ...session, user: null })
      if (request.url.endsWith('/featured-venues')) return Response.json([])
      if (request.url.includes('/standings?'))
        return Response.json({ items: [], hasMore: false, provisional: true })
      if (request.url.endsWith(`/competitions/${competition.id}`))
        return Response.json(competition)
      throw new Error(
        'Public visitors must not request member or invitation data',
      )
    })
    vi.stubGlobal('fetch', fetch)
    show(`/competitions/${competition.id}`)
    expect(
      await screen.findByRole('heading', { name: competition.name }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Members' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Publish competition' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Edit settings' }),
    ).not.toBeInTheDocument()
    expect(
      fetch.mock.calls.some(([request]) =>
        /members|invitations/.test(request.url),
      ),
    ).toBe(false)
  })

  it('submits a CSRF-protected private draft using the selected time zone', async () => {
    let submitted: Record<string, unknown> | undefined
    const draft = {
      ...competition,
      visibility: 'PRIVATE',
      published: false,
      phase: 'DRAFT',
      viewerRole: 'ORGANIZER',
      canAdminister: true,
      version: 0,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/auth/session')) return Response.json(session)
        if (
          request.method === 'POST' &&
          request.url.endsWith('/competitions')
        ) {
          expect(request.headers.get('X-CSRF-TOKEN')).toBe('test-csrf')
          submitted = (await request.json()) as Record<string, unknown>
          return Response.json(draft, { status: 201 })
        }
        if (request.url.endsWith('/invitations')) return Response.json([])
        if (request.url.endsWith('/invitation-emails'))
          return Response.json([
            {
              id: 'queued',
              email: 'friend@example.test',
              status: 'PENDING',
              lastError: null,
              sentAt: null,
            },
          ])
        if (request.url.endsWith('/featured-venues')) return Response.json([])
        if (request.url.includes('/venues?'))
          return Response.json({ items: [], hasMore: false })
        if (request.url.includes('/members'))
          return Response.json({ items: [], hasMore: false })
        if (request.url.includes('/meals?'))
          return Response.json({ items: [], hasMore: false })
        return Response.json(draft)
      }),
    )
    show('/competitions/new')
    fireEvent.change(await screen.findByLabelText('Competition name'), {
      target: { value: competition.name },
    })
    fireEvent.change(screen.getByLabelText('Competition time zone'), {
      target: { value: 'America/New_York' },
    })
    fireEvent.change(screen.getByLabelText('Eating starts'), {
      target: { value: '2030-07-01T12:00' },
    })
    fireEvent.change(screen.getByLabelText('Eating ends'), {
      target: { value: '2030-07-02T12:00' },
    })
    expect(screen.getByLabelText('What are you tracking?')).toHaveValue('BOTH')
    fireEvent.change(screen.getByLabelText('What are you tracking?'), {
      target: { value: 'COUNT' },
    })
    fireEvent.change(screen.getByLabelText('Invite by email (optional)'), {
      target: {
        value: 'Friend@example.test,\nfriend@example.test; second@example.test',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() =>
      expect(submitted).toMatchObject({
        visibility: 'PRIVATE',
        startsAt: '2030-07-01T16:00:00Z',
        endsAt: '2030-07-02T16:00:00Z',
        allowSharedMeals: false,
        trackingMode: 'COUNT',
        invitationEmails: ['friend@example.test', 'second@example.test'],
      }),
    )
    expect(submitted).not.toHaveProperty('organizerId')
    expect(
      await screen.findByRole('button', { name: 'Publish competition' }),
    ).toBeVisible()
    expect(
      await screen.findByText('Waiting to send', { exact: false }),
    ).toBeVisible()
  })

  it.each([
    'invalid-address',
    Array.from(
      { length: 21 },
      (_, index) => `friend${index}@example.test`,
    ).join(','),
  ])(
    'rejects invalid or oversized invitation lists without creating a draft',
    async (addresses) => {
      const fetch = vi.fn(async (request: Request) =>
        Response.json(request.url.endsWith('/auth/session') ? session : {}),
      )
      vi.stubGlobal('fetch', fetch)
      show('/competitions/new')
      fireEvent.change(await screen.findByLabelText('Competition name'), {
        target: { value: 'Email crew' },
      })
      fireEvent.change(screen.getByLabelText('Eating starts'), {
        target: { value: '2030-07-01T12:00' },
      })
      fireEvent.change(screen.getByLabelText('Eating ends'), {
        target: { value: '2030-07-02T12:00' },
      })
      fireEvent.change(screen.getByLabelText('Invite by email (optional)'), {
        target: { value: addresses },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'up to 20 valid email addresses',
      )
      expect(
        fetch.mock.calls.some(([request]) => request.method === 'POST'),
      ).toBe(false)
    },
  )

  it('lets the organizer inspect delivery failures and retry without re-publishing', async () => {
    let sent = false
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/auth/session')) return Response.json(session)
      if (request.url.endsWith('/invitation-emails')) {
        if (request.method === 'POST') {
          expect(request.headers.get('X-CSRF-TOKEN')).toBe('test-csrf')
          sent = true
        }
        return Response.json([
          {
            id: 'mail-one',
            email: 'friend@example.test',
            status: sent ? 'SENT' : 'FAILED',
            lastError: sent ? null : 'DELIVERY_FAILED',
            sentAt: null,
          },
        ])
      }
      if (
        request.url.endsWith('/featured-venues') ||
        request.url.endsWith('/invitations')
      )
        return Response.json([])
      if (/\?/.test(request.url))
        return Response.json({ items: [], hasMore: false, provisional: true })
      return Response.json({
        ...competition,
        viewerRole: 'ORGANIZER',
        canAdminister: true,
      })
    })
    vi.stubGlobal('fetch', fetch)
    show(`/competitions/${competition.id}`)
    fireEvent.click(
      await screen.findByText('Email invitations', { exact: true }),
    )
    expect(await screen.findByText(/SMTP delivery failed/)).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Send pending or failed invitations',
      }),
    )
    await waitFor(() =>
      expect(
        screen.queryByText(/SMTP delivery failed/),
      ).not.toBeInTheDocument(),
    )
    expect(
      fetch.mock.calls.filter(([request]) => request.method === 'POST'),
    ).toHaveLength(1)
  })

  it('previews an invitation without automatically joining', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/auth/session')) return Response.json(session)
      if (request.url.endsWith('/inspect'))
        return Response.json({
          competitionId: competition.id,
          name: competition.name,
          rules: competition.rules,
          timeZone: competition.timeZone,
          startsAt: competition.startsAt,
          endsAt: competition.endsAt,
          allowSharedMeals: false,
          expiresAt: competition.endsAt,
        })
      throw new Error('An invitation was accepted without confirmation')
    })
    vi.stubGlobal('fetch', fetch)
    show(`/join?token=${'A'.repeat(43)}`)
    expect(
      await screen.findByRole('heading', { name: competition.name }),
    ).toBeVisible()
    expect(
      await screen.findByRole('button', { name: 'Accept invitation' }),
    ).toBeEnabled()
    expect(
      fetch.mock.calls.some(([request]) => request.url.endsWith('/join')),
    ).toBe(false)
  })
})
