import { createApiClient } from '@glizzy/api-client'

function client() {
  return createApiClient(new URL('/api/v1', window.location.origin).href)
}

const messages: Record<string, string> = {
  INVALID_LINK:
    'This link is invalid, expired, or already used. Request a new one.',
  IDENTITY_IN_USE:
    'That sign-in method belongs to another account. Accounts were not merged.',
  PROVIDER_ALREADY_LINKED:
    'This account already has that sign-in method linked.',
  LINK_REQUIRES_ORIGINAL_ACCOUNT:
    'Sign in to the original account, then reopen this link.',
  ALREADY_SIGNED_IN: 'Sign out before using a link for a different account.',
  EMAIL_DISABLED: 'Email sign-in is not configured on this server.',
  GOOGLE_DISABLED: 'Google sign-in is not configured on this server.',
}

function check(response: Response, error?: { error: string }) {
  if (!response.ok) {
    throw new Error(
      messages[error?.error ?? ''] ?? 'The request failed. Please try again.',
    )
  }
}

export async function loadSession(signal?: AbortSignal) {
  const { data, error, response } = await client().GET('/auth/session', {
    signal,
  })
  check(response, error)
  if (!data) throw new Error('Could not load your account.')
  return data
}

async function csrf() {
  const session = await loadSession()
  return { 'X-CSRF-TOKEN': session.csrfToken }
}

export async function requestEmail(email: string) {
  const { error, response } = await client().POST('/auth/magic-links', {
    params: { header: await csrf() },
    body: { email },
  })
  check(response, error)
}

export async function inspectLink(token: string) {
  const { data, error, response } = await client().POST(
    '/auth/magic-links/inspect',
    {
      params: { header: await csrf() },
      body: { token },
    },
  )
  check(response, error)
  if (!data) throw new Error('Could not inspect this link.')
  return data
}

export async function confirmLink(token: string) {
  const { error, response } = await client().POST('/auth/magic-links/confirm', {
    params: { header: await csrf() },
    body: { token },
  })
  check(response, error)
}

export async function startGoogle(link: boolean) {
  const { data, error, response } = await client().POST('/auth/google', {
    params: { header: await csrf() },
    body: { link },
  })
  check(response, error)
  if (!data) throw new Error('Could not start Google sign-in.')
  window.location.assign(data.authorizationUrl)
}

export async function renameProfile(displayName: string) {
  const { error, response } = await client().PUT('/me', {
    params: { header: await csrf() },
    body: { displayName },
  })
  check(response, error)
}

export async function logout() {
  const { response } = await client().POST('/auth/logout', {
    params: { header: await csrf() },
  })
  check(response)
}
