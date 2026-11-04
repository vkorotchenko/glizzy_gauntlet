import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Captain',
  siteOwner: true,
  roles: ['ADMIN'],
  providers: ['email'],
}
const candidate = {
  id: '00000000-0000-4000-8000-000000000002',
  displayName: 'Candidate',
  roles: [] as string[],
}
const session = {
  user,
  csrfToken: 'role-csrf',
  csrfHeader: 'X-CSRF-TOKEN',
  emailEnabled: false,
  googleEnabled: false,
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

describe('global role management', () => {
  it('grants and revokes using CSRF and displays last-admin protection', async () => {
    let roles: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/auth/session')) return Response.json(session)
        if (request.method !== 'GET') {
          expect(request.headers.get('X-CSRF-TOKEN')).toBe('role-csrf')
          if (request.url.includes(user.id))
            return Response.json({ error: 'LAST_ADMIN' }, { status: 409 })
          roles = request.method === 'PUT' ? ['VENUE_APPROVER'] : []
          return Response.json({ ...candidate, roles })
        }
        return Response.json({
          items: [{ ...user }, { ...candidate, roles }],
          hasMore: false,
        })
      }),
    )
    show('/account/roles')
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Grant Venue approver to Candidate',
      }),
    )
    expect(
      await screen.findByRole('button', {
        name: 'Revoke Venue approver from Candidate',
      }),
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Revoke Venue approver from Candidate',
      }),
    )
    expect(
      await screen.findByRole('button', {
        name: 'Grant Venue approver to Candidate',
      }),
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'Revoke Admin from Captain' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Keep at least one Admin.',
    )
  })

  it('does not expose or request role management for a venue approver', async () => {
    const fetch = vi.fn(async (_request: Request) =>
      Response.json({
        ...session,
        user: { ...user, siteOwner: false, roles: ['VENUE_APPROVER'] },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    show('/account/roles')
    expect(
      await screen.findByText('Only admins can manage global roles.'),
    ).toBeVisible()
    expect(
      screen.queryByRole('link', { name: 'Role management' }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(
      fetch.mock.calls.every(([request]) =>
        request.url.endsWith('/auth/session'),
      ),
    ).toBe(true)
  })
})
