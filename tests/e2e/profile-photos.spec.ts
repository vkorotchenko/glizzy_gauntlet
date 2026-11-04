import { expect, test } from '@playwright/test'
import type { components } from '../../packages/api-client/src/schema'

test('uploads, replaces, and removes profile pictures across account and meal screens', async ({
  page,
}) => {
  const first = '00000000-0000-4000-8000-000000000002'
  const replacement = '00000000-0000-4000-8000-000000000003'
  const competitorPhoto = '00000000-0000-4000-8000-000000000004'
  let user: components['schemas']['Profile'] = {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Test diner',
    providers: ['email'],
    roles: [],
    siteOwner: false,
    profilePhotoId: null,
  }
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  )
  const meal: components['schemas']['Meal'] = {
    id: '00000000-0000-4000-8000-000000000005',
    version: 1,
    archived: false,
    revision: {
      id: '00000000-0000-4000-8000-000000000006',
      version: 1,
      eatenAt: '2026-01-01T12:00:00Z',
      location: 'Home',
      venueId: null,
      notes: 'Private lunch.',
      items: [
        {
          name: 'Classic dog',
          wholeQuantity: 1,
          unitHundredths: 0,
          partialHundredths: 0,
          condiments: ['Mustard'],
        },
      ],
      photoIds: ['meal-photo-one', 'meal-photo-two', 'meal-photo-three'],
      totalHundredths: 0,
      wholeHotDogs: 1,
    },
    submissions: [],
  }
  let uploads = 0
  let removes = 0
  let imagesUnavailable = false
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const json = (body: unknown, status = 200) =>
      route.fulfill({ json: body, status })
    if (path.endsWith('/auth/session'))
      return json({
        user,
        csrfToken: 'test-csrf',
        csrfHeader: 'X-CSRF-TOKEN',
        emailEnabled: true,
        googleEnabled: false,
      })
    if (path.endsWith('/me/photo') && request.method() === 'PUT') {
      expect(request.headers()['x-csrf-token']).toBe('test-csrf')
      expect(request.headers()['content-type']).toContain(
        'multipart/form-data; boundary=',
      )
      const body = request.postDataBuffer()!
      expect(body.includes(png)).toBe(true)
      if (user.profilePhotoId)
        expect(body.toString()).toContain(
          `name="expectedPhotoId"\r\n\r\n${user.profilePhotoId}`,
        )
      else expect(body.toString()).not.toContain('name="expectedPhotoId"')
      uploads++
      user = { ...user, profilePhotoId: uploads === 1 ? first : replacement }
      return json(user)
    }
    if (path.endsWith('/me/photo') && request.method() === 'DELETE') {
      expect(request.headers()['x-csrf-token']).toBe('test-csrf')
      expect(url.searchParams.get('expectedPhotoId')).toBe(replacement)
      removes++
      user = { ...user, profilePhotoId: null }
      return json(user)
    }
    if (path.includes('/profile-photos/'))
      return !imagesUnavailable &&
        [user.profilePhotoId, competitorPhoto].some(
          (id) => id && path.endsWith(id),
        )
        ? route.fulfill({ contentType: 'image/png', body: png })
        : route.fulfill({ status: 404 })
    if (path.endsWith('/meals')) return json({ items: [meal], hasMore: false })
    if (path.includes('/meal-photos/'))
      return route.fulfill({ contentType: 'image/png', body: png })
    if (path.endsWith('/feed'))
      return json({
        items: [
          {
            id: meal.id,
            competitionId: null,
            competitionName: null,
            displayName: user.displayName,
            profilePhotoId: user.profilePhotoId,
            revision: meal.revision,
            scoreExcluded: false,
            totalHundredths: meal.revision.totalHundredths,
            wholeHotDogs: meal.revision.wholeHotDogs,
            reactionCount: 0,
            reacted: false,
          },
          {
            id: 'entry-one',
            competitionId: 'competition-one',
            competitionName: 'Test crew',
            displayName: 'Another diner',
            profilePhotoId: competitorPhoto,
            revision: {
              id: 'revision-one',
              version: 1,
              eatenAt: '2026-01-01T11:00:00Z',
              location: 'Home',
              venueId: null,
              notes: '',
              items: [],
              photoIds: [],
              totalHundredths: 0,
              wholeHotDogs: 1,
            },
            scoreExcluded: false,
            totalHundredths: 0,
            wholeHotDogs: 1,
            reactionCount: 0,
            reacted: false,
          },
        ],
        hasMore: false,
      })
    if (path.endsWith('/meal-photos')) return json([])
    return json({ items: [], hasMore: false })
  })

  await page.goto('/account')
  await page.getByLabel('Display name').fill('Unsaved nickname')
  const chooser = page.getByLabel('Choose profile picture')
  await chooser.setInputFiles({
    name: 'invalid.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  })
  await expect(page.getByRole('alert')).toHaveText(
    'Choose a JPEG or PNG image.',
  )
  await chooser.setInputFiles({
    name: 'picture.png',
    mimeType: 'image/png',
    buffer: png,
  })
  await expect(
    page.getByRole('img', { name: 'Selected profile picture preview' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Save profile picture' }).click()
  const picture = page.getByRole('img', {
    name: "Test diner's profile picture",
  })
  await expect(picture).toHaveAttribute('src', new RegExp(first))
  await expect
    .poll(() =>
      picture.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0)
  await expect(page.getByLabel('Display name')).toHaveValue('Unsaved nickname')
  const accountLink = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'My account', exact: true })
  await expect(accountLink.locator('img')).toHaveAttribute(
    'src',
    new RegExp(first),
  )
  await expect(chooser).toHaveValue('')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  await page
    .getByRole('navigation', { name: 'Account navigation' })
    .getByRole('link', { name: 'My feed', exact: true })
    .click()
  const ownCard = page.getByRole('article', { name: "Test diner's meal" })
  await expect(
    ownCard.getByRole('img', { name: "Test diner's profile picture" }),
  ).toHaveAttribute('src', new RegExp(first))
  for (const [index, id] of meal.revision.photoIds.entries()) {
    const photo = ownCard.getByRole('img', { name: `Meal photo ${index + 1}` })
    await expect(photo).toHaveAttribute(
      'src',
      `/api/v1/meal-photos/${id}?thumbnail=true`,
    )
    await expect
      .poll(() =>
        photo.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0)
  }
  await expect(ownCard.getByText('Private lunch.')).toBeVisible()
  await expect(ownCard.getByText('Mustard')).toBeVisible()
  await expect(
    ownCard
      .getByRole('group', { name: 'Meal totals and likes' })
      .getByText('1 hot dog'),
  ).toBeVisible()
  await expect(
    ownCard.getByRole('link', { name: 'Classic dog' }),
  ).toHaveAttribute('href', `/meals/${meal.id}`)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  await page.goto('/meals/new')
  await expect(
    page
      .getByRole('article', { name: 'Meal preview' })
      .getByRole('img', { name: "Test diner's profile picture" }),
  ).toHaveAttribute('src', new RegExp(first))
  await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(2)
  expect(
    await page
      .getByRole('article')
      .evaluateAll((cards) =>
        cards.map((card) => card.getAttribute('aria-label')),
      ),
  ).toEqual(["Test diner's meal", "Another diner's meal in Test crew"])
  await expect(
    ownCard.getByRole('img', { name: "Test diner's profile picture" }),
  ).toHaveAttribute('src', new RegExp(first))
  await expect(ownCard.getByRole('img')).toHaveCount(4)
  await expect(
    ownCard.getByRole('link', { name: 'View meal' }),
  ).toHaveAttribute('href', `/meals/${meal.id}`)
  await expect(ownCard.getByRole('button', { name: 'Like' })).toHaveCount(0)
  const card = page.getByRole('article', {
    name: "Another diner's meal in Test crew",
  })
  await expect(
    card.getByRole('img', { name: "Another diner's profile picture" }),
  ).toHaveAttribute('src', new RegExp(competitorPhoto))

  await page.goto('/account')
  await chooser.setInputFiles({
    name: 'replacement.png',
    mimeType: 'image/png',
    buffer: png,
  })
  await page.getByRole('button', { name: 'Save profile picture' }).click()
  await expect(picture).toHaveAttribute('src', new RegExp(replacement))
  await expect(accountLink.locator('img')).toHaveAttribute(
    'src',
    new RegExp(replacement),
  )
  await page.goto('/account/meals')
  await expect(
    ownCard.getByRole('img', { name: "Test diner's profile picture" }),
  ).toHaveAttribute('src', new RegExp(replacement))
  await page.goto('/account')
  await page.getByRole('button', { name: 'Remove profile picture' }).click()
  await expect(picture).toHaveCount(0)
  await expect(accountLink.locator('img')).toHaveCount(0)
  expect({ uploads, removes }).toEqual({ uploads: 2, removes: 1 })

  await page.goto('/account/meals')
  await expect(
    ownCard.getByRole('img', { name: "Test diner's profile picture" }),
  ).toHaveCount(0)
  await expect(ownCard.locator('.user-avatar')).toHaveText('T')
  await expect(ownCard.getByRole('img')).toHaveCount(3)

  imagesUnavailable = true
  await page.goto('/')
  await expect(
    card.getByRole('img', { name: "Another diner's profile picture" }),
  ).toHaveCount(0)
  await expect(card.locator('.user-avatar')).toHaveText('A')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})
