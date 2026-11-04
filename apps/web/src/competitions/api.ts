import { createApiClient, type components } from '@glizzy/api-client'
import { loadSession } from '../auth/api'

export type Competition = components['schemas']['Competition']
export type Settings = components['schemas']['CompetitionSettings']
export type TrackingMode = Competition['trackingMode']
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
  EMAIL_DISABLED:
    'Email delivery is unavailable. Leave the invitation list blank or configure email first.',
  INVALID_INVITATION_EMAILS: 'Enter up to 20 valid email addresses.',
  PHOTO_LIMIT:
    'Cover photo limit reached (200 competitions per organizer). Remove an unused cover first.',
  STORAGE_LIMIT: 'Photo storage is full. Contact the site owner.',
  IMAGE_TOO_LARGE: 'Choose a JPEG or PNG no larger than 5 MiB.',
  INVALID_IMAGE:
    'Choose a valid JPEG or PNG: at most 6000 pixels per side and 12 megapixels.',
  MEDIA_UNAVAILABLE: 'Photo storage is unavailable. Try again later.',
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
  scope: 'public' | 'mine' | 'joined' | 'administered' | 'participating',
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

export async function loggingCompetitions(signal?: AbortSignal) {
  const competitions: Competition[] = []
  for (let page = 0; page <= 1000; page++) {
    const result = await listCompetitions('mine', page, signal)
    competitions.push(
      ...result.items.filter(
        (item) => item.published && ['ACTIVE', 'GRACE'].includes(item.phase),
      ),
    )
    if (!result.hasMore) return competitions
  }
  throw new Error('Too many joined competitions to load safely.')
}

export async function getCompetition(id: string, signal?: AbortSignal) {
  return data(
    await client().GET('/competitions/{id}', {
      params: { path: { id } },
      signal,
    }),
  )
}

export async function createCompetition(
  settings: Settings,
  invitationEmails: string[] = [],
  cover?: File | null,
) {
  const competition = { ...settings, invitationEmails }
  const form = new FormData()
  if (cover) {
    form.append(
      'competition',
      new Blob([JSON.stringify(competition)], { type: 'application/json' }),
    )
    form.append('file', cover)
  }
  return data(
    await client().POST('/competitions', {
      params: { header: await csrf() },
      body: cover ? { competition, file: cover.name } : competition,
      bodySerializer: cover ? () => form : undefined,
    }),
  )
}

export async function uploadCompetitionCover(
  id: string,
  version: number,
  file: File,
) {
  const form = new FormData()
  form.append('version', String(version))
  form.append('file', file)
  return data(
    await client().PUT('/competitions/{id}/cover', {
      params: { path: { id }, header: await csrf() },
      body: { version, file: file.name },
      bodySerializer: () => form,
    }),
  )
}

export async function removeCompetitionCover(id: string, version: number) {
  return data(
    await client().DELETE('/competitions/{id}/cover', {
      params: { path: { id }, query: { version }, header: await csrf() },
    }),
  )
}

export function coverPhotoUrl(competition: Competition, thumbnail = false) {
  return `/api/v1/competitions/${encodeURIComponent(competition.id)}/cover/${encodeURIComponent(competition.coverPhotoId!)}?thumbnail=${thumbnail}`
}

export async function listInvitationEmails(id: string, signal?: AbortSignal) {
  return data(
    await client().GET('/competitions/{id}/invitation-emails', {
      params: { path: { id } },
      signal,
    }),
  )
}

export async function sendInvitationEmails(id: string) {
  return data(
    await client().POST('/competitions/{id}/invitation-emails', {
      params: { path: { id }, header: await csrf() },
    }),
  )
}

export async function leaveCompetition(id: string) {
  return data(
    await client().POST('/competitions/{id}/leave', {
      params: { path: { id }, header: await csrf() },
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
