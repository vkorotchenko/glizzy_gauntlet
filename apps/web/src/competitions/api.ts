import { createApiClient, type components } from '@glizzy/api-client'
import { loadSession } from '../auth/api'

export type Competition = components['schemas']['Competition']
export type Settings = components['schemas']['CompetitionSettings']
export type Member = components['schemas']['CompetitionMember']
const client = () =>
  createApiClient(new URL('/api/v1', window.location.origin).href)
const csrf = async () => ({
  'X-CSRF-TOKEN': (await loadSession()).csrfToken,
})

const messages: Record<string, string> = {
  NOT_FOUND: 'This competition is unavailable or private.',
  UNAUTHENTICATED: 'Sign in to continue.',
  INVALID_REQUEST: 'Check the fields and try again.',
  INVALID_TIME_ZONE: 'Enter a valid IANA time zone, such as America/New_York.',
  INVALID_WINDOW:
    'Use valid dates with the end after the start and at most millisecond precision.',
  START_MUST_BE_FUTURE:
    'Choose a start in the future before saving or publishing.',
  SETTINGS_LOCKED:
    'Settings locked when eating started. Reload to see the current competition.',
  VERSION_CONFLICT:
    'Settings changed in another tab. Reload before trying again.',
  JOINING_CLOSED: 'Joining closed when the eating window ended.',
  PUBLISH_FIRST: 'Publish the competition before creating invitations.',
  MEMBERS_ONLY: 'Only competition members can see this.',
  ORGANIZER_ONLY: 'Only the organizer can change this competition.',
  INVALID_INVITATION:
    'This invitation is invalid, revoked, expired, or closed.',
  INVITATION_LIMIT:
    'Revoke an active invitation before creating more (maximum 20).',
  MEMBERSHIP_EXCLUDED:
    'The organizer has excluded this account from participating.',
  CANNOT_EXCLUDE_ORGANIZER: 'The organizer cannot be excluded.',
}

function check(reply: { response: Response; error?: { error: string } }) {
  if (!reply.response.ok)
    throw new Error(
      messages[reply.error?.error ?? ''] ??
        'The request failed. Check your sign-in and try again.',
    )
}

function data<T>(reply: {
  response: Response
  error?: { error: string }
  data?: T
}): T {
  check(reply)
  if (reply.data === undefined) throw new Error('The server returned no data.')
  return reply.data
}

export async function listCompetitions(
  scope: 'public' | 'mine',
  page: number,
  signal?: AbortSignal,
) {
  return data(
    await client().GET('/competitions', {
      params: { query: { scope, page } },
      signal,
    }),
  )
}

export async function getCompetition(id: string, signal?: AbortSignal) {
  return data(
    await client().GET('/competitions/{id}', {
      params: { path: { id } },
      signal,
    }),
  )
}

export async function createCompetition(settings: Settings) {
  return data(
    await client().POST('/competitions', {
      params: { header: await csrf() },
      body: settings,
    }),
  )
}

export async function updateCompetition(
  id: string,
  version: number,
  settings: Settings,
) {
  return data(
    await client().PUT('/competitions/{id}', {
      params: { path: { id }, header: await csrf() },
      body: { version, settings },
    }),
  )
}

export async function publishCompetition(id: string, version: number) {
  return data(
    await client().POST('/competitions/{id}/publish', {
      params: { path: { id }, header: await csrf() },
      body: { version },
    }),
  )
}

export async function joinCompetition(id: string) {
  return data(
    await client().POST('/competitions/{id}/join', {
      params: { path: { id }, header: await csrf() },
    }),
  )
}

export async function listMembers(
  id: string,
  page: number,
  signal?: AbortSignal,
) {
  return data(
    await client().GET('/competitions/{id}/members', {
      params: { path: { id }, query: { page } },
      signal,
    }),
  )
}

export async function excludeMember(id: string, user: string, reason: string) {
  check(
    await client().POST('/competitions/{id}/members/{user}/exclude', {
      params: { path: { id, user }, header: await csrf() },
      body: { reason },
    }),
  )
}

export async function listInvitations(id: string, signal?: AbortSignal) {
  return data(
    await client().GET('/competitions/{id}/invitations', {
      params: { path: { id } },
      signal,
    }),
  )
}

export async function createInvitation(id: string) {
  return data(
    await client().POST('/competitions/{id}/invitations', {
      params: { path: { id }, header: await csrf() },
    }),
  )
}

export async function revokeInvitation(id: string, invitation: string) {
  check(
    await client().DELETE('/competitions/{id}/invitations/{invitation}', {
      params: { path: { id, invitation }, header: await csrf() },
    }),
  )
}

export async function inspectInvitation(token: string) {
  return data(
    await client().POST('/competition-invitations/inspect', {
      params: { header: await csrf() },
      body: { token },
    }),
  )
}

export async function acceptInvitation(token: string) {
  return data(
    await client().POST('/competition-invitations/join', {
      params: { header: await csrf() },
      body: { token },
    }),
  )
}
