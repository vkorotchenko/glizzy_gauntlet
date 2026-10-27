import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

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

describe('foundation home', () => {
  it('reports the real API result and identifies the page as a preview', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: 'UP' }))
    vi.stubGlobal('fetch', fetch)
    renderApp()

    expect(
      await screen.findByText('API and database connected'),
    ).toBeInTheDocument()
    expect(fetch.mock.calls[0][0].url).toMatch(/\/api\/v1\/status$/)
    expect(screen.getByText(/Foundation preview/)).toBeInTheDocument()
    expect(screen.getByLabelText('Scoring example')).toHaveTextContent(
      'This illustration is not a saved meal.',
    )
  })

  it('recovers after the API becomes available', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: 'DOWN' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status: 'UP' }))
    vi.stubGlobal('fetch', fetch)
    renderApp()

    expect(await screen.findByText('API unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(
      await screen.findByText('API and database connected'),
    ).toBeInTheDocument()
  })

  it('handles a network failure without presenting a fake connected state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Network error')),
    )
    renderApp()
    expect(await screen.findByText('API unavailable')).toBeInTheDocument()
    expect(
      screen.queryByText('API and database connected'),
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
