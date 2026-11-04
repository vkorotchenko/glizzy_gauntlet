import { createApiClient, type components } from '@glizzy/api-client'

export type GlobalRole = components['schemas']['GlobalRole']
export type Profile = components['schemas']['Profile']

export function isAdmin(user: Profile | null | undefined) {
  return Boolean(user?.roles?.includes('ADMIN'))
}

export function canReviewVenues(user: Profile | null | undefined) {
  return isAdmin(user) || Boolean(user?.roles?.includes('VENUE_APPROVER'))
}

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
  ADMIN_ONLY: 'Only admins can manage global roles.',
  LAST_ADMIN:
    'Keep at least one Admin. Grant Admin to another account before revoking this role.',
  INVALID_REQUEST: 'Check the account and role and try again.',
  NOT_FOUND: 'This account is unavailable.',
  PHOTO_CONFLICT:
    'Your profile picture changed in another tab. Reload before trying again.',
  INVALID_IMAGE: 'Choose a valid JPEG or PNG image.',
  IMAGE_TOO_LARGE: 'Choose a JPEG or PNG no larger than 5 MiB.',
  STORAGE_LIMIT: 'Image storage is full. Please try again later.',
  MEDIA_UNAVAILABLE: 'Image storage is temporarily unavailable.',
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

export function profilePhotoUrl(id: string, thumbnail = true) {
  return `/api/v1/profile-photos/${encodeURIComponent(id)}?thumbnail=${thumbnail}`
}

export async function uploadProfilePhoto(
  file: File,
  expectedPhotoId: string | null,
) {
  const { data, error, response } = await client().PUT('/me/photo', {
    params: { header: await csrf() },
    body: {
      file: file.name,
      ...(expectedPhotoId ? { expectedPhotoId } : {}),
    },
    bodySerializer: () => {
      const body = new FormData()
      body.append('file', file)
      if (expectedPhotoId) body.append('expectedPhotoId', expectedPhotoId)
      return body
    },
  })
  check(response, error)
  if (!data) throw new Error('Could not update your profile picture.')
  return data
}

export async function removeProfilePhoto(expectedPhotoId: string | null) {
  const { data, error, response } = await client().DELETE('/me/photo', {
    params: {
      header: await csrf(),
      query: expectedPhotoId ? { expectedPhotoId } : {},
    },
  })
  check(response, error)
  if (!data) throw new Error('Could not remove your profile picture.')
  return data
}

export async function logout() {
  const { response } = await client().POST('/auth/logout', {
    params: { header: await csrf() },
  })
  check(response)
}

export async function listRoleAccounts(
  query: string,
  page: number,
  signal?: AbortSignal,
) {
  const { data, error, response } = await client().GET('/admin/accounts', {
    params: { query: { query, page } },
    signal,
  })
  check(response, error)
  if (!data) throw new Error('Could not load accounts.')
  return data
}

export async function changeGlobalRole(
  id: string,
  role: GlobalRole,
  grant: boolean,
) {
  const options = { params: { path: { id, role }, header: await csrf() } }
  const result = grant
    ? await client().PUT('/admin/accounts/{id}/roles/{role}', options)
    : await client().DELETE('/admin/accounts/{id}/roles/{role}', options)
  check(result.response, result.error)
  return result.data
}
