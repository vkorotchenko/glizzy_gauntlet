import { createApiClient, type components } from '@glizzy/api-client'
import { loadSession } from '../auth/api'

export type Venue = components['schemas']['Venue']
export type Contribution = components['schemas']['Contribution']
export type DirectoryInput = components['schemas']['DirectoryInput']
export type Scope = 'mine' | 'pending' | 'all'
const client = () =>
  createApiClient(new URL('/api/v1', window.location.origin).href)
const csrf = async () => ({ 'X-CSRF-TOKEN': (await loadSession()).csrfToken })

const messages: Record<string, string> = {
  NOT_FOUND: 'This listing or contribution is unavailable.',
  INVALID_REQUEST: 'Check the fields and try again.',
  UNAUTHENTICATED: 'Sign in to continue.',
  OWNER_ONLY: 'Only the site owner can moderate the directory.',
  ORGANIZER_ONLY: 'Only the organizer can choose featured venues.',
  VERSION_CONFLICT:
    'This listing has a newer approved revision. Discard this suggestion and start from the current listing.',
  CONTRIBUTION_LOCKED: 'This contribution is already submitted or reviewed.',
  CONTRIBUTION_LIMIT: 'Submit or discard an open draft first (maximum 20).',
  PHOTO_LIMIT: 'Photo limit reached: 10 per draft and 200 per contributor.',
  STORAGE_LIMIT: 'Photo storage is full. Contact the site owner.',
  IMAGE_TOO_LARGE: 'Choose a JPEG or PNG no larger than 5 MiB.',
  INVALID_IMAGE:
    'Choose a valid JPEG or PNG: at most 6000 pixels per side and 12 megapixels.',
  MEDIA_UNAVAILABLE: 'Photo storage is unavailable. Try again later.',
  FEATURED_LIMIT: 'Remove a featured venue first (maximum 20).',
}

function check(response: Response, error?: { error: string }) {
  if (!response.ok)
    throw new Error(
      messages[error?.error ?? ''] ??
        'The request failed. Check your sign-in and try again.',
    )
}

function data<T>(reply: {
  response: Response
  data?: T
  error?: { error: string }
}): T {
  check(reply.response, reply.error)
  if (reply.data === undefined) throw new Error('The server returned no data.')
  return reply.data
}

export async function listVenues(page: number, signal?: AbortSignal) {
  return data(
    await client().GET('/venues', { params: { query: { page } }, signal }),
  )
}
export async function getVenue(id: string, signal?: AbortSignal) {
  return data(
    await client().GET('/venues/{id}', { params: { path: { id } }, signal }),
  )
}
export async function listContributions(
  scope: Scope,
  page: number,
  signal?: AbortSignal,
) {
  return data(
    await client().GET('/directory/contributions', {
      params: { query: { scope, page } },
      signal,
    }),
  )
}
export async function getContribution(id: string, signal?: AbortSignal) {
  return data(
    await client().GET('/directory/contributions/{id}', {
      params: { path: { id } },
      signal,
    }),
  )
}
export async function createContribution(body: DirectoryInput) {
  return data(
    await client().POST('/directory/contributions', {
      params: { header: await csrf() },
      body,
    }),
  )
}
export async function submitContribution(id: string) {
  return data(
    await client().POST('/directory/contributions/{id}/submit', {
      params: { path: { id }, header: await csrf() },
    }),
  )
}
export async function discardContribution(id: string) {
  const reply = await client().DELETE('/directory/contributions/{id}', {
    params: { path: { id }, header: await csrf() },
  })
  check(reply.response, reply.error)
}
export async function uploadPhoto(id: string, file: File, menuItemId: string) {
  const form = new FormData()
  form.append('file', file)
  if (menuItemId) form.append('menuItemId', menuItemId)
  const reply = await client().POST('/directory/contributions/{id}/photos', {
    params: { path: { id }, header: await csrf() },
    body: { file: file.name, ...(menuItemId ? { menuItemId } : {}) },
    bodySerializer: () => form,
  })
  return data(reply)
}
export async function reviewContribution(
  id: string,
  approve: boolean,
  reason: string,
) {
  return data(
    await client().POST('/directory/contributions/{id}/review', {
      params: { path: { id }, header: await csrf() },
      body: { approve, reason },
    }),
  )
}
export async function setVisibility(
  id: string,
  hidden: boolean,
  reason: string,
) {
  const reply = await client().PUT('/venues/{id}/visibility', {
    params: { path: { id }, header: await csrf() },
    body: { hidden, reason },
  })
  check(reply.response, reply.error)
}
export function photoUrl(id: string, thumbnail = true) {
  return `/api/v1/directory/photos/${encodeURIComponent(id)}?thumbnail=${thumbnail}`
}
export async function listFeatured(id: string, signal?: AbortSignal) {
  return data(
    await client().GET('/competitions/{id}/featured-venues', {
      params: { path: { id } },
      signal,
    }),
  )
}
export async function featureVenue(id: string, venue: string, add: boolean) {
  const params = { path: { id, venue }, header: await csrf() }
  const reply = add
    ? await client().PUT('/competitions/{id}/featured-venues/{venue}', {
        params,
      })
    : await client().DELETE('/competitions/{id}/featured-venues/{venue}', {
        params,
      })
  check(reply.response, reply.error)
}
