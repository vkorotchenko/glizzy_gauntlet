import { createApiClient, type components } from '@glizzy/api-client'
import { loadSession } from '../auth/api'

export type FeedItem = components['schemas']['FeedItem']
export type FeedPage = components['schemas']['FeedPage']
const client = () =>
  createApiClient(new URL('/api/v1', window.location.origin).href)

function data<T>(reply: {
  response: Response
  data?: T
  error?: { error: string }
}): T {
  if (!reply.response.ok)
    throw new Error(
      reply.response.status === 401
        ? 'Sign in again to see your crew.'
        : reply.response.status === 404
          ? 'This meal is no longer available to you. Refresh your feed.'
          : 'Could not load or update your feed. Please try again.',
    )
  if (reply.data === undefined) throw new Error('The server returned no data.')
  return reply.data
}

export async function listFeed(page: number, signal?: AbortSignal) {
  return data(
    await client().GET('/feed', {
      params: { query: { page } },
      signal,
    }),
  )
}

export async function setReaction(id: string, reacted: boolean) {
  return data(
    await client().PUT('/feed/{id}/reaction', {
      params: {
        path: { id },
        header: { 'X-CSRF-TOKEN': (await loadSession()).csrfToken },
      },
      body: { reacted },
    }),
  )
}
