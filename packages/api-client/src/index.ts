import createClient from 'openapi-fetch'
import type { paths } from './schema'
export type { components } from './schema'

export function createApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl, credentials: 'same-origin' })
}
