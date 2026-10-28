import { createApiClient, type components } from '@glizzy/api-client'
import { loadSession } from '../auth/api'

export type Correction = components['schemas']['ScoreCorrection']
const client = () =>
  createApiClient(new URL('/api/v1', window.location.origin).href)
const messages: Record<string, string> = {
  RECAP_NOT_READY:
    'The recap becomes available after the 24-hour submission grace period ends.',
  NOT_FOUND: 'This competition or recap revision is unavailable or private.',
  MEMBERS_ONLY: 'Only active competition members can see these details.',
  ORGANIZER_ONLY: 'Only this competition organizer can correct scores.',
  VERSION_CONFLICT:
    'This entry changed. Refresh the entries before trying again.',
  REQUEST_CONFLICT:
    'This retry differs from the original correction. Refresh before trying again.',
  ENTRY_WITHDRAWN:
    'Withdrawn entries cannot be reinstated by a score correction.',
  NO_SCORE_CHANGE:
    'Change the score or its scoring-exclusion setting before publishing.',
  INVALID_REQUEST: 'Check the measurements, whole count, and required reason.',
}
function data<T>(reply: {
  response: Response
  data?: T
  error?: { error: string }
}) {
  if (!reply.response.ok || reply.data === undefined)
    throw new Error(
      messages[reply.error?.error ?? ''] ??
        'Could not load or save the recap. Check your sign-in and try again.',
    )
  return reply.data
}
export async function recap(
  id: string,
  version: number | undefined,
  page: number,
  signal?: AbortSignal,
) {
  return data(
    await client().GET('/competitions/{id}/recap', {
      params: { path: { id }, query: { version, page } },
      signal,
    }),
  )
}
export async function history(id: string, page: number, signal?: AbortSignal) {
  return data(
    await client().GET('/competitions/{id}/recap/history', {
      params: { path: { id }, query: { page } },
      signal,
    }),
  )
}
export async function highlights(
  id: string,
  version: number,
  signal?: AbortSignal,
) {
  return data(
    await client().GET('/competitions/{id}/recap/highlights', {
      params: { path: { id }, query: { version } },
      signal,
    }),
  )
}
export async function audit(id: string, page: number, signal?: AbortSignal) {
  return data(
    await client().GET('/competitions/{id}/corrections', {
      params: { path: { id }, query: { page } },
      signal,
    }),
  )
}
export async function correct(id: string, entry: string, body: Correction) {
  return data(
    await client().POST('/competitions/{id}/entries/{entry}/corrections', {
      params: {
        path: { id, entry },
        header: { 'X-CSRF-TOKEN': (await loadSession()).csrfToken },
      },
      body,
    }),
  )
}
