import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'

const session = {
  user: null,
  csrfToken: 'test-csrf-token',
  csrfHeader: 'X-CSRF-TOKEN',
  googleEnabled: false,
  emailEnabled: true,
}

function show(path: string) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('account screens', () => {
  it('sends an email request with the session CSRF token and reports a generic outcome', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.method === 'GET') return Response.json(session)
      expect(request.url).toMatch(/\/auth\/magic-links$/)
      expect(request.headers.get('X-CSRF-TOKEN')).toBe('test-csrf-token')
      expect(await request.json()).toEqual({ email: 'diner@example.test' })
      return new Response(null, { status: 202 })
    })
    vi.stubGlobal('fetch', fetch)
    show('/sign-in')
    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: 'diner@example.test' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Email me a sign-in link' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If delivery is available',
    )
    expect(
      screen.queryByRole('button', { name: 'Continue with Google' }),
    ).not.toBeInTheDocument()
  })

  it('inspects a link without authenticating until the person confirms the displayed email', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.method === 'GET') return Response.json(session)
      if (request.url.endsWith('/inspect'))
        return Response.json({
          email: 'diner@example.test',
          purpose: 'sign-in',
        })
      throw new Error('A link was consumed without confirmation')
    })
    vi.stubGlobal('fetch', fetch)
    show(`/sign-in/confirm?token=${'A'.repeat(43)}`)
    expect(await screen.findByText('diner@example.test')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Confirm sign-in' }),
    ).toBeEnabled()
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(([request]) =>
          request.url.endsWith('/confirm'),
        ),
      ).toHaveLength(0),
    )
  })

  it('clearly identifies disabled sign-in options', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ ...session, emailEnabled: false })),
    )
    show('/sign-in')
    expect(
      await screen.findByText(
        'Email sign-in is not configured on this server yet.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
  })
})
