import { createApiClient, type components } from '@glizzy/api-client'
import { loadSession } from '../auth/api'

export type Meal = components['schemas']['Meal']
export type Revision = components['schemas']['MealRevision']
export type Save = components['schemas']['MealSave']
export type Submission = components['schemas']['MealSubmission']
const client = () =>
  createApiClient(new URL('/api/v1', window.location.origin).href)
const csrf = async () => ({ 'X-CSRF-TOKEN': (await loadSession()).csrfToken })
const messages: Record<string, string> = {
  NOT_FOUND: 'This meal or photo is unavailable.',
  INVALID_REQUEST: 'Check the fields and use whole hundredths of an inch.',
  INVALID_MEASUREMENT:
    'Each item needs a length, and a positive whole quantity or partial portion smaller than that length.',
  INVALID_EATEN_AT:
    'Choose a past or current time, with at most millisecond precision.',
  LOCATION_REQUIRED:
    'Enter a private location label or choose an approved venue.',
  LOCATION_CONFLICT:
    'Choose either a venue or a private location label, not both.',
  INVALID_VENUE:
    'Choose a currently approved venue or enter a private location label.',
  VERSION_CONFLICT:
    'This meal or submission changed in another tab. Reload before trying again.',
  REQUEST_CONFLICT:
    'This retry does not match the original request. Reload before trying again.',
  MEAL_ARCHIVED: 'Archived sources cannot be edited or submitted again.',
  TARGET_UNAVAILABLE:
    'A selected competition is unavailable, unpublished, or not joined. Nothing was saved.',
  SUBMISSIONS_CLOSED:
    'A selected submission window has closed. Nothing was saved.',
  OUTSIDE_EATING_WINDOW:
    'The eating time is outside a selected competition eating window. Nothing was saved.',
  SHARING_NOT_ALLOWED:
    'Every competition with a nonwithdrawn submission of this meal must allow sharing. Nothing was saved.',
  MEMBERS_ONLY: 'Only competition members can see submitted meals.',
  INVALID_PHOTO: 'A selected photo is unavailable or belongs to another meal.',
  PHOTO_IN_USE:
    'This photo is retained by a meal revision. Remove it from a new revision instead.',
  PHOTO_LIMIT:
    'Private photo limit reached (200 per account). Discard unused uploads.',
  STORAGE_LIMIT: 'Photo storage is full. Contact the site owner.',
  IMAGE_TOO_LARGE: 'Choose a JPEG or PNG no larger than 5 MiB.',
  INVALID_IMAGE:
    'Choose a valid JPEG or PNG: at most 6000 pixels per side and 12 megapixels.',
}
function check(
  response: Response,
  error?: { error: string; competitionId?: string | null },
) {
  if (!response.ok)
    throw new Error(
      (messages[error?.error ?? ''] ??
        'The request failed. Check your sign-in and try again.') +
        (error?.competitionId ? ` Competition: ${error.competitionId}.` : ''),
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
export async function listMeals(
  archived: boolean,
  page: number,
  signal?: AbortSignal,
) {
  return data(
    await client().GET('/meals', {
      params: { query: { archived, page } },
      signal,
    }),
  )
}
export async function getMeal(id: string, signal?: AbortSignal) {
  return data(
    await client().GET('/meals/{id}', { params: { path: { id } }, signal }),
  )
}
export async function history(id: string, page: number, signal?: AbortSignal) {
  return data(
    await client().GET('/meals/{id}/history', {
      params: { path: { id }, query: { page } },
      signal,
    }),
  )
}
export async function saveMeal(id: string | undefined, body: Save) {
  return data(
    id
      ? await client().PUT('/meals/{id}', {
          params: { path: { id }, header: await csrf() },
          body,
        })
      : await client().POST('/meals', {
          params: { header: await csrf() },
          body,
        }),
  )
}
export async function archiveMeal(
  id: string,
  version: number,
  requestId: string,
) {
  return data(
    await client().POST('/meals/{id}/archive', {
      params: { path: { id }, header: await csrf() },
      body: { version, requestId },
    }),
  )
}
export async function withdraw(
  id: string,
  competition: string,
  version: number,
  requestId: string,
) {
  return data(
    await client().POST('/meals/{id}/submissions/{competition}/withdraw', {
      params: { path: { id, competition }, header: await csrf() },
      body: { version, requestId },
    }),
  )
}
export async function listEntries(
  id: string,
  page: number,
  signal?: AbortSignal,
) {
  return data(
    await client().GET('/competitions/{id}/meals', {
      params: { path: { id }, query: { page } },
      signal,
    }),
  )
}
export async function stagedPhotos(signal?: AbortSignal) {
  return data(await client().GET('/meal-photos', { signal }))
}
export async function uploadPhoto(file: File) {
  const form = new FormData()
  form.append('file', file)
  return data(
    await client().POST('/meal-photos', {
      params: { header: await csrf() },
      body: { file: file.name },
      bodySerializer: () => form,
    }),
  )
}
export async function discardPhoto(id: string) {
  const reply = await client().DELETE('/meal-photos/{id}', {
    params: { path: { id }, header: await csrf() },
  })
  check(reply.response, reply.error)
}
export function photoUrl(id: string, thumbnail = true) {
  return `/api/v1/meal-photos/${encodeURIComponent(id)}?thumbnail=${thumbnail}`
}
