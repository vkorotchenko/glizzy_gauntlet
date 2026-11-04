import { expect, test } from '@playwright/test'
import type { components } from '../../packages/api-client/src/schema'

test('creates, displays, replaces, and removes competition cover photos', async ({
  page,
}) => {
  const competitionId = '00000000-0000-4000-8000-000000000002'
  const firstCover = '00000000-0000-4000-8000-000000000003'
  const nextCover = '00000000-0000-4000-8000-000000000004'
  let current: components['schemas']['Competition'] = {
    id: competitionId,
    name: 'Test cover crew',
    rules: '',
    visibility: 'PUBLIC',
    timeZone: 'UTC',
    startsAt: '2030-07-01T12:00:00Z',
    endsAt: '2030-07-02T12:00:00Z',
    submissionClosesAt: '2030-07-03T12:00:00Z',
    allowSharedMeals: false,
    trackingMode: 'COUNT',
    allTime: false,
    published: false,
    version: 0,
    phase: 'DRAFT',
    viewerRole: 'ORGANIZER',
    canAdminister: true,
    memberCount: 1,
    coverPhotoId: null,
  }
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  )
  let creates = 0
  let replaces = 0
  let removes = 0
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const json = (body: unknown, status = 200) =>
      route.fulfill({ json: body, status })
    if (path.endsWith('/auth/session'))
      return json({
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          displayName: 'Test organizer',
          providers: ['email'],
          roles: [],
        },
        csrfToken: 'test-csrf',
        csrfHeader: 'X-CSRF-TOKEN',
        emailEnabled: true,
        googleEnabled: false,
      })
    if (path.endsWith('/competitions') && request.method() === 'POST') {
      expect(request.headers()['x-csrf-token']).toBe('test-csrf')
      expect(request.headers()['content-type']).toContain(
        'multipart/form-data; boundary=',
      )
      const body = request.postDataBuffer()!
      expect(body.includes(png)).toBe(true)
      expect(body.toString()).toContain('name="competition"')
      expect(body.toString()).toContain('"name":"Test cover crew"')
      expect(body.toString()).toContain('"invitationEmails":[]')
      creates++
      current = { ...current, coverPhotoId: firstCover, version: 1 }
      return json(current, 201)
    }
    if (path.endsWith('/cover') && request.method() === 'PUT') {
      expect(request.headers()['x-csrf-token']).toBe('test-csrf')
      const body = request.postDataBuffer()!
      expect(body.includes(png)).toBe(true)
      expect(body.toString()).toContain('name="version"\r\n\r\n1')
      replaces++
      current = { ...current, coverPhotoId: nextCover, version: 2 }
      return json(current)
    }
    if (path.endsWith('/cover') && request.method() === 'DELETE') {
      expect(request.headers()['x-csrf-token']).toBe('test-csrf')
      expect(url.searchParams.get('version')).toBe('2')
      removes++
      current = { ...current, coverPhotoId: null, version: 3 }
      return json(current)
    }
    if (path.includes('/cover/'))
      return route.fulfill({ contentType: 'image/png', body: png })
    if (path.endsWith('/competitions'))
      return json({ items: [current], hasMore: false })
    if (path.endsWith(`/competitions/${competitionId}`)) return json(current)
    if (/\/(featured-venues|invitations|invitation-emails)$/.test(path))
      return json([])
    return json({ items: [], hasMore: false })
  })

  await page.goto('/competitions/new')
  await page.getByLabel('Competition name', { exact: true }).fill(current.name)
  await page.getByLabel('Competition time zone').fill('UTC')
  await page
    .getByLabel('Eating starts', { exact: true })
    .fill('2030-07-01T12:00')
  await page.getByLabel('Eating ends', { exact: true }).fill('2030-07-02T12:00')
  await page.getByLabel('Choose cover photo').setInputFiles({
    name: 'invalid.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  })
  await expect(page.getByRole('alert')).toHaveText(
    'Choose a JPEG or PNG image.',
  )
  await page.getByLabel('Choose cover photo').setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: png,
  })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(
    page.getByRole('img', { name: 'Selected cover photo preview' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(`/competitions/${competitionId}`)
  const cover = page.getByRole('img', {
    name: `${current.name} cover photo`,
  })
  await expect(cover).toHaveAttribute('src', new RegExp(firstCover))
  await expect(cover).toBeVisible()
  await expect
    .poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0)
  await page.goto('/competitions')
  await expect(
    page
      .getByRole('region', { name: 'My competitions' })
      .getByRole('img', { name: `${current.name} cover photo` }),
  ).toHaveAttribute('src', /thumbnail=true/)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  await page.goto(`/competitions/${competitionId}`)
  await page.getByText('Manage cover photo', { exact: true }).click()
  await page.getByLabel('Choose cover photo').setInputFiles({
    name: 'replacement.png',
    mimeType: 'image/png',
    buffer: png,
  })
  await page
    .getByRole('button', { name: 'Save cover photo', exact: true })
    .click()
  await expect(cover).toHaveAttribute('src', new RegExp(nextCover))
  await expect(page.getByRole('status')).toHaveText('Cover photo updated.')
  await page
    .getByRole('button', { name: 'Remove cover photo', exact: true })
    .click()
  await expect(cover).toHaveCount(0)
  expect({ creates, replaces, removes }).toEqual({
    creates: 1,
    replaces: 1,
    removes: 1,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})
