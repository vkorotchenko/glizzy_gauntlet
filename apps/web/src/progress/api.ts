import { createApiClient } from '@glizzy/api-client'
import type { components } from '@glizzy/api-client'

export type Progress = components['schemas']['PersonalProgress']
export type Day = components['schemas']['ProgressDay']
export type Standing = components['schemas']['Standing']
const client = () =>
  createApiClient(new URL('/api/v1', window.location.origin).href)
function data<T>(reply: {
  response: Response
  data?: T
  error?: { error: string }
}) {
  if (!reply.response.ok || reply.data === undefined)
    throw new Error(
      reply.error?.error === 'NOT_FOUND'
        ? 'This competition is unavailable or private.'
        : reply.error?.error === 'MEMBERS_ONLY'
          ? 'Join this competition to view your own progress.'
          : 'Could not load results. Check your sign-in and try again.',
    )
  return reply.data
}
export async function standings(
  id: string,
  page: number,
  signal?: AbortSignal,
) {
  return data(
    await client().GET('/competitions/{id}/standings', {
      params: { path: { id }, query: { page } },
      signal,
    }),
  )
}
export async function personal(
  id: string,
  dayPage: number,
  placePage: number,
  signal?: AbortSignal,
) {
  return data(
    await client().GET('/competitions/{id}/progress', {
      params: { path: { id }, query: { dayPage, placePage } },
      signal,
    }),
  )
}
