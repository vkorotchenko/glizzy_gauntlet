import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { Competition } from './api'

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Captain',
  siteOwner: false,
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
  published: true,
  version: 1,
  phase: 'SCHEDULED',
  viewerRole: 'NONE',
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
  it('does not request member details or expose organizer controls to public visitors', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/auth/session'))
        return Response.json({ ...session, user: null })
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
        if (request.url.includes('/members'))
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
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() =>
      expect(submitted).toMatchObject({
        visibility: 'PRIVATE',
        startsAt: '2030-07-01T16:00:00Z',
        endsAt: '2030-07-02T16:00:00Z',
        allowSharedMeals: false,
      }),
    )
    expect(submitted).not.toHaveProperty('organizerId')
    expect(
      await screen.findByRole('button', { name: 'Publish competition' }),
    ).toBeVisible()
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
