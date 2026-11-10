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
import * as auth from './api'

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
  return cache
}

describe('account screens', () => {
  it('uploads, replaces, and removes profile pictures without discarding an unsaved display name', async () => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL() {
          return 'blob:profile-preview'
        }
        static revokeObjectURL() {}
      },
    )
    let profile: auth.Profile = {
      id: 'test-user',
      displayName: 'Diner',
      providers: ['email'],
      roles: [],
      siteOwner: false,
      profilePhotoId: null,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...session, user: profile })),
    )
    const upload = vi
      .spyOn(auth, 'uploadProfilePhoto')
      .mockImplementation(async (_file, expected) => {
        profile = {
          ...profile,
          profilePhotoId: expected ? 'replacement-photo' : 'first-photo',
        }
        return profile
      })
    const remove = vi
      .spyOn(auth, 'removeProfilePhoto')
      .mockImplementation(async () => {
        profile = { ...profile, profilePhotoId: null }
        return profile
      })
    show('/account')
    const name = await screen.findByLabelText('Display name')
    fireEvent.change(name, { target: { value: 'Unsaved name' } })
    const chooser = screen.getByLabelText('Choose profile picture')
    const first = new File(['picture'], 'first.png', { type: 'image/png' })
    fireEvent.change(chooser, { target: { files: [first] } })
    expect(
      screen.getByRole('img', { name: 'Selected profile picture preview' }),
    ).toHaveAttribute('src', 'blob:profile-preview')
    fireEvent.click(
      screen.getByRole('button', { name: 'Save profile picture' }),
    )
    await waitFor(() => expect(upload).toHaveBeenCalledWith(first, null))
    const picture = await screen.findByRole('img', {
      name: "Diner's profile picture",
    })
    expect(picture).toHaveAttribute(
      'src',
      '/api/v1/profile-photos/first-photo?thumbnail=true',
    )
    expect(name).toHaveValue('Unsaved name')
    const account = within(
      screen.getByRole('navigation', { name: 'Main navigation' }),
    ).getByRole('link', { name: 'My account' })
    expect(account.querySelector('img')).toHaveAttribute(
      'src',
      '/api/v1/profile-photos/first-photo?thumbnail=true',
    )
    fireEvent.error(picture)
    expect(picture).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Profile picture' })).getByText(
        'D',
      ),
    ).toBeVisible()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Remove profile picture' }),
      ).toBeEnabled(),
    )
    const next = new File(['next'], 'next.png', { type: 'image/png' })
    fireEvent.change(chooser, { target: { files: [next] } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Save profile picture' }),
    )
    await waitFor(() =>
      expect(upload).toHaveBeenCalledWith(next, 'first-photo'),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: "Diner's profile picture" }),
      ).toHaveAttribute(
        'src',
        '/api/v1/profile-photos/replacement-photo?thumbnail=true',
      ),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Remove profile picture' }),
      ).toBeEnabled(),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove profile picture' }),
    )
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith('replacement-photo'),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('img', { name: "Diner's profile picture" }),
      ).not.toBeInTheDocument(),
    )
    expect(name).toHaveValue('Unsaved name')
    expect(account.querySelector('img')).toBeNull()
  })

  it('rejects invalid pictures and clears a previous selection instead of uploading it', async () => {
    const revoke = vi.fn()
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL() {
          return 'blob:profile-preview'
        }
        static revokeObjectURL(url: string) {
          revoke(url)
        }
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...session,
          user: {
            id: 'test-user',
            displayName: 'Diner',
            providers: ['email'],
            roles: [],
          },
        }),
      ),
    )
    show('/account')
    const chooser = await screen.findByLabelText('Choose profile picture')
    fireEvent.change(chooser, {
      target: {
        files: [new File(['svg'], 'picture.svg', { type: 'image/svg+xml' })],
      },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose a JPEG or PNG image.',
    )
    fireEvent.change(chooser, {
      target: {
        files: [
          new File(['x'.repeat(5 * 1024 * 1024 + 1)], 'huge.png', {
            type: 'image/png',
          }),
        ],
      },
    })
    expect(screen.getByRole('alert')).toHaveTextContent('no larger than 5 MiB')
    const valid = new File(['picture'], 'picture.png', { type: 'image/png' })
    fireEvent.change(chooser, { target: { files: [valid] } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save profile picture' }),
    ).toBeEnabled()
    fireEvent.change(chooser, {
      target: {
        files: [new File(['svg'], 'picture.svg', { type: 'image/svg+xml' })],
      },
    })
    expect(
      screen.queryByRole('img', { name: 'Selected profile picture preview' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save profile picture' }),
    ).toBeDisabled()
    expect(revoke).toHaveBeenCalledWith('blob:profile-preview')
  })

  it('preserves the current picture when a stale upload is rejected', async () => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL() {
          return 'blob:profile-preview'
        }
        static revokeObjectURL() {}
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'PUT') {
          expect(request.headers.get('X-CSRF-TOKEN')).toBe('test-csrf-token')
          return Response.json({ error: 'PHOTO_CONFLICT' }, { status: 409 })
        }
        return Response.json({
          ...session,
          user: {
            id: 'test-user',
            displayName: 'Diner',
            providers: ['email'],
            roles: [],
            profilePhotoId: 'original-photo',
          },
        })
      }),
    )
    show('/account')
    fireEvent.change(await screen.findByLabelText('Choose profile picture'), {
      target: {
        files: [new File(['picture'], 'picture.png', { type: 'image/png' })],
      },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Save profile picture' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your profile picture changed in another tab.',
    )
    expect(
      screen.getByRole('img', { name: "Diner's profile picture" }),
    ).toHaveAttribute(
      'src',
      '/api/v1/profile-photos/original-photo?thumbnail=true',
    )
  })

  it.each(['sign-in', 'link'] as const)(
    'updates the navigation and landing page after confirming %s without reloading',
    async (purpose) => {
      const profile = {
        id: 'test-user',
        displayName: 'Diner',
        providers: ['email'],
        siteOwner: false,
      }
      let signedIn = purpose === 'link'
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: Request) => {
          if (new URL(request.url).pathname === '/api/v1/feed')
            return Response.json({
              items: [],
              page: 0,
              size: 20,
              hasMore: false,
            })
          if (request.method === 'GET')
            return Response.json({
              ...session,
              user: signedIn ? profile : null,
            })
          if (request.url.endsWith('/inspect'))
            return Response.json({
              email: 'diner@example.test',
              purpose,
            })
          if (request.url.endsWith('/confirm')) {
            signedIn = true
            return Response.json(profile)
          }
          throw new Error(`Unexpected request: ${request.url}`)
        }),
      )
      show(`/sign-in/confirm?token=${'A'.repeat(43)}`)
      const navigation = within(
        screen.getByRole('navigation', { name: 'Main navigation' }),
      )
      expect(
        await navigation.findByRole('link', {
          name: purpose === 'link' ? 'My account' : 'Sign in',
        }),
      ).toBeInTheDocument()

      fireEvent.click(
        await screen.findByRole('button', {
          name: purpose === 'link' ? 'Confirm email link' : 'Confirm sign-in',
        }),
      )

      expect(
        await navigation.findByRole('link', { name: 'My account' }),
      ).toBeInTheDocument()
      expect(
        navigation.queryByRole('link', { name: 'My meals' }),
      ).not.toBeInTheDocument()
      expect(
        await screen.findByRole('heading', {
          name: purpose === 'link' ? 'Your account' : 'Your feed',
        }),
      ).toBeVisible()
      if (purpose === 'sign-in') {
        expect(navigation.getByRole('link', { name: 'Feed' })).toHaveAttribute(
          'aria-current',
          'page',
        )
      }
      expect(
        navigation.queryByRole('link', { name: 'Sign in' }),
      ).not.toBeInTheDocument()
    },
  )

  it('sends an already signed-in visitor from the sign-in page to the main feed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) =>
        request.url.endsWith('/auth/session')
          ? Response.json({
              ...session,
              user: {
                id: 'test-user',
                displayName: 'Diner',
                providers: ['email'],
                siteOwner: false,
              },
            })
          : Response.json({ items: [], page: 0, size: 20, hasMore: false }),
      ),
    )
    show('/sign-in')
    expect(
      await screen.findByRole('heading', { name: 'Your feed' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Sign in to your crew.' }),
    ).not.toBeInTheDocument()
  })

  it('replaces personal navigation with sign-in after signing out', async () => {
    let signedIn = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'GET')
          return Response.json({
            ...session,
            user: signedIn
              ? {
                  id: 'test-user',
                  displayName: 'Diner',
                  providers: ['email'],
                  siteOwner: false,
                }
              : null,
          })
        if (request.url.endsWith('/auth/logout')) {
          signedIn = false
          return new Response(null, { status: 204 })
        }
        throw new Error(`Unexpected request: ${request.url}`)
      }),
    )
    const cache = show('/account')
    cache.setQueryData(['meals'], ['private meal'])
    const navigation = within(
      screen.getByRole('navigation', { name: 'Main navigation' }),
    )
    expect(
      await navigation.findByRole('link', { name: 'My account' }),
    ).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(
      await navigation.findByRole('link', { name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(
      navigation.queryByRole('link', { name: 'My meals' }),
    ).not.toBeInTheDocument()
    expect(
      navigation.queryByRole('link', { name: 'My account' }),
    ).not.toBeInTheDocument()
    expect(cache.getQueryData(['meals'])).toBeUndefined()
    expect(
      screen.queryByRole('navigation', { name: 'Account navigation' }),
    ).not.toBeInTheDocument()
  })

  it('keeps account tabs available while navigating personal venues, competitions, and meals', async () => {
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/auth/session'))
        return Response.json({
          ...session,
          user: {
            id: 'test-user',
            displayName: 'Diner',
            providers: ['email'],
            siteOwner: false,
          },
        })
      if (request.url.includes('/meals?'))
        return Response.json({
          items: [
            {
              id: 'private-meal',
              version: 1,
              archived: false,
              revision: {
                id: 'private-revision',
                version: 1,
                eatenAt: '2026-10-28T12:00:00Z',
                venueId: null,
                items: [],
                photoIds: [],
                notes: '',
                totalHundredths: 0,
                wholeHotDogs: 2,
                location: 'My kitchen',
              },
              submissions: [],
            },
          ],
          hasMore: false,
        })
      if (
        request.url.includes('/contributions?') ||
        request.url.includes('/competitions?')
      )
        return Response.json({ items: [], hasMore: false })
      throw new Error(`Unexpected account request: ${request.url}`)
    })
    vi.stubGlobal('fetch', fetch)
    show('/account')
    const tabs = within(
      await screen.findByRole('navigation', { name: 'Account navigation' }),
    )
    expect(
      tabs.getByRole('link', { name: 'Profile settings' }),
    ).toHaveAttribute('aria-current', 'page')
    for (const [tab, heading, action] of [
      ['My venues', 'My venues', 'Suggest a venue'],
      ['My competitions', 'My competitions', 'Create a competition'],
      ['My feed', 'My meals', 'Log a meal'],
    ]) {
      fireEvent.click(tabs.getByRole('link', { name: tab }))
      const title = await screen.findByRole('heading', {
        name: heading,
        level: 1,
      })
      expect(title).toBeVisible()
      expect(
        within(title.parentElement!).getByRole('link', { name: action }),
      ).toBeVisible()
      expect(tabs.getByRole('link', { name: tab })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(
        tabs.getByRole('link', { name: 'Profile settings' }),
      ).not.toHaveAttribute('aria-current')
    }
    expect(await screen.findByText(/My kitchen/)).toBeVisible()
    expect(
      within(
        screen.getByRole('navigation', { name: 'Main navigation' }),
      ).getByRole('link', { name: 'My account' }),
    ).toHaveAttribute('aria-current', 'page')
    fireEvent.click(tabs.getByRole('link', { name: 'Profile settings' }))
    expect(await screen.findByLabelText('Display name')).toHaveValue('Diner')
    expect(
      within(screen.getByLabelText('Display name').parentElement!).getByRole(
        'button',
        { name: 'Save display name' },
      ),
    ).toBeVisible()
    expect(
      tabs.getByRole('link', { name: 'Profile settings' }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it.each(['/meals', '/account/meals'])(
    'keeps the personal feed at %s private for visitors',
    async (path) => {
      const fetch = vi.fn(async (request: Request) => {
        expect(request.url).toMatch(/\/auth\/session$/)
        return Response.json(session)
      })
      vi.stubGlobal('fetch', fetch)
      show(path)
      expect(
        await screen.findByRole('heading', { name: 'Sign in to continue' }),
      ).toBeVisible()
      expect(
        screen.queryByRole('navigation', { name: 'Account navigation' }),
      ).not.toBeInTheDocument()
      expect(fetch).toHaveBeenCalledOnce()
    },
  )

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
