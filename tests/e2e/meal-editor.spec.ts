import { expect, test } from '@playwright/test'
import type { components } from '../../packages/api-client/src/schema'

type Save = components['schemas']['MealSave']

test('previews hot dog rows, condiments, and three uploaded photos without overflowing', async ({
  page,
}) => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Test diner',
    providers: ['email'],
    roles: [],
  }
  const competition = {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Test lunch crew',
    trackingMode: 'BOTH',
    rules: '',
    timeZone: 'UTC',
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2027-01-01T00:00:00Z',
    submissionClosesAt: '2027-01-02T00:00:00Z',
    allowSharedMeals: true,
    allTime: false,
    published: true,
    phase: 'ACTIVE',
  }
  const nearVenue = {
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Z nearby stand',
    address: 'Near street',
    latitude: 0,
    longitude: 179.95,
  }
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: 0, longitude: 179.9 })
  let saved: Save | undefined
  let stored: components['schemas']['Meal'] | undefined
  let uploads = 0
  let venueRequests = 0
  let mapRequests = 0
  let mapUnavailable = false
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  )
  await page.route('https://tiles.openfreemap.org/**', (route) => {
    mapRequests++
    return mapUnavailable
      ? route.abort()
      : route.fulfill({ json: { version: 8, sources: {}, layers: [] } })
  })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
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
    if (path.endsWith('/competitions'))
      return json({ items: [competition], hasMore: false })
    if (path.endsWith('/venues')) {
      venueRequests++
      return json(
        new URL(request.url()).searchParams.get('page') === '0'
          ? {
              items: [
                {
                  ...nearVenue,
                  id: '00000000-0000-4000-8000-000000000006',
                  name: 'A distant stand',
                  longitude: 0,
                },
              ],
              hasMore: true,
            }
          : { items: [nearVenue], hasMore: false },
      )
    }
    if (path.endsWith('/history')) return json({ items: [], hasMore: false })
    if (path.endsWith('/meal-photos'))
      return request.method() === 'POST'
        ? json({ id: `photo-${++uploads}` }, 201)
        : json([])
    if (path.includes('/meal-photos/'))
      return route.fulfill({ contentType: 'image/png', body: png })
    if (path.endsWith('/meals') && request.method() === 'POST') {
      saved = request.postDataJSON() as Save
      stored = {
        id: '00000000-0000-4000-8000-000000000003',
        version: 1,
        archived: false,
        revision: {
          ...saved.content,
          venueId: saved.content.venueId ?? null,
          location: saved.content.location ?? '',
          id: '00000000-0000-4000-8000-000000000004',
          version: 1,
          eatenAt: saved.content.eatenAt ?? new Date().toISOString(),
          wholeHotDogs: 2,
          totalHundredths: 1450,
        },
        submissions: [],
      }
      return json(stored, 201)
    }
    if (stored && path.endsWith(`/meals/${stored.id}`)) return json(stored)
    return json({ items: [], hasMore: false })
  })
  await page.goto('/meals/new')
  const preview = page.getByRole('article', { name: 'Meal preview' })
  await expect(
    preview.getByRole('heading', { name: 'Test diner' }),
  ).toBeVisible()
  await expect(
    page.getByRole('radio', { name: 'Home', exact: true }),
  ).toBeChecked()
  await expect(
    page.getByRole('group', { name: 'Approved venue (optional)' }),
  ).toHaveCount(0)
  expect(venueRequests).toBe(0)
  expect(mapRequests).toBe(0)
  await page.getByLabel('Description for hot dog 1').fill('Ballpark dog')
  await page.getByLabel('Inches for hot dog 1').fill('7.25')
  await page.getByRole('button', { name: 'Condiments for hot dog 1' }).click()
  const dialog = page.getByRole('dialog', { name: 'Condiments for hot dog 1' })
  await dialog.getByLabel('Mustard', { exact: true }).check()
  await dialog.getByLabel('Relish', { exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Condiments for hot dog 1 (2 selected)' }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Duplicate hot dog 1' }).click()
  await expect(preview.getByText('2 hot dogs')).toBeVisible()
  await expect(preview.getByText('14.50 inches')).toBeVisible()
  await expect(preview.getByText('Mustard, Relish')).toHaveCount(2)
  await expect(page.getByLabel('Description for hot dog 2')).toHaveValue(
    'Ballpark dog',
  )
  const chooser = page.waitForEvent('filechooser')
  await preview
    .getByRole('button', { name: 'Add meal photos: choose or drag and drop' })
    .click()
  await (
    await chooser
  ).setFiles({ name: 'one.png', mimeType: 'image/png', buffer: png })
  await expect(
    preview.getByRole('img', { name: 'Meal preview photo 1' }),
  ).toBeVisible()
  const save = page.getByRole('button', {
    name: 'Save meal and selected submissions',
  })
  await expect(save).toBeEnabled()
  await page.getByLabel('Add photos (up to 3)').setInputFiles([
    { name: 'two.png', mimeType: 'image/png', buffer: png },
    { name: 'three.png', mimeType: 'image/png', buffer: png },
  ])
  await expect(preview.getByRole('img')).toHaveCount(3)
  await expect(save).toBeEnabled()
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(new File(['test image'], 'four.png', { type: 'image/png' }))
    return data
  })
  await preview
    .getByRole('button')
    .dispatchEvent('drop', { dataTransfer: transfer })
  await expect(page.getByRole('alert')).toContainText('at most 3 photos')
  expect(uploads).toBe(3)
  const all = page.getByRole('checkbox', {
    name: 'Share with all eligible competitions',
  })
  await expect(all).toBeChecked()
  await expect(
    page.getByRole('group', { name: 'Choose competitions' }),
  ).toHaveCount(0)
  await all.uncheck()
  await page
    .getByRole('checkbox', { name: 'Submit to Test lunch crew' })
    .check()
  await all.check()
  await expect(
    page.getByRole('group', { name: 'Choose competitions' }),
  ).toHaveCount(0)
  await page.getByRole('radio', { name: 'Somewhere else' }).check()
  const venueOptions = page.getByRole('group', {
    name: 'Approved venue (optional)',
  })
  await expect(venueOptions.getByRole('radio').nth(1)).toHaveAccessibleName(
    /A distant stand/,
  )
  await page.getByRole('button', { name: 'Use my location' }).click()
  await expect(venueOptions.getByRole('radio').nth(1)).toHaveAccessibleName(
    /Z nearby stand/,
  )
  await venueOptions.getByRole('radio', { name: /Z nearby stand/ }).check()
  expect(mapRequests).toBe(0)
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  const map = page.getByRole('region', { name: 'Approved venue map' })
  await expect(
    map.getByRole('button', { name: 'Select Z nearby stand', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => mapRequests).toBeGreaterThan(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await map.getByRole('button', { name: 'Select A distant stand' }).click()
  await expect(
    preview.getByText(/A distant stand \/ Near street/),
  ).toBeVisible()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(
    venueOptions.getByRole('radio', { name: /A distant stand/ }),
  ).toBeChecked()
  await venueOptions.getByRole('radio', { name: /Z nearby stand/ }).check()
  expect(saved).toBeUndefined()
  await page.getByRole('radio', { name: 'Home', exact: true }).check()
  await expect(venueOptions).toHaveCount(0)
  await expect(preview.getByText(/ \/ Home$/)).toBeVisible()
  await page.getByRole('radio', { name: 'Somewhere else' }).check()
  await expect(
    venueOptions.getByRole('radio', { name: /Z nearby stand/ }),
  ).toBeChecked()
  mapUnavailable = true
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(
    page.getByText(
      'Map unavailable. Switch to List to choose a venue, or refresh to try again.',
    ),
  ).toBeVisible()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(
    venueOptions.getByRole('radio', { name: /Z nearby stand/ }),
  ).toBeChecked()
  await expect(
    venueOptions.getByRole('button', { name: 'Next page' }),
  ).toHaveCount(0)
  await page.getByLabel('Meal date', { exact: true }).fill('2026-10-28')
  await page.getByLabel('Meal time', { exact: true }).fill('12:07')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await save.click()
  await expect(
    page.getByRole('heading', { name: 'Meal record', exact: true }),
  ).toBeVisible()
  expect(saved?.content.items).toHaveLength(2)
  expect(saved?.content.items[0].condiments).toEqual(['Mustard', 'Relish'])
  expect(saved?.content.photoIds).toHaveLength(3)
  expect(saved?.competitionIds).toEqual([competition.id])
  expect(saved?.content.venueId).toBe(nearVenue.id)
  expect(new Date(saved!.content.eatenAt!).getUTCMinutes() % 15).toBe(0)
})
