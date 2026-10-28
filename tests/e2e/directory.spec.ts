import { execFileSync } from 'node:child_process'
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

async function signIn(page: Page, request: APIRequestContext, tag: string) {
  const email = `${tag}-${Date.now()}@example.test`
  const inbox = process.env.MAILPIT_BASE_URL ?? 'http://127.0.0.1:8025'
  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByRole('status')).toContainText(
    'If delivery is available',
  )
  let id = ''
  await expect
    .poll(async () => {
      const messages = (await (
        await request.get(`${inbox}/api/v1/messages`)
      ).json()) as {
        messages: { ID: string; To: { Address: string }[] }[]
      }
      id =
        messages.messages.find((message) =>
          message.To.some((to) => to.Address === email),
        )?.ID ?? ''
      return id
    })
    .not.toBe('')
  const message = (await (
    await request.get(`${inbox}/api/v1/message/${id}`)
  ).json()) as { Text: string }
  const link = message.Text.match(
    /https?:\/\/\S+\/sign-in\/confirm\?token=[A-Za-z0-9_-]{43}/,
  )?.[0]
  expect(link).toBeTruthy()
  await page.goto(link!)
  await page.getByRole('button', { name: 'Confirm sign-in' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your account' }),
  ).toBeVisible()
  await expect(page.getByLabel('Display name')).toBeVisible()
}

async function draft(page: Page, name: string) {
  await page.goto('/venues/new')
  await page.getByLabel('Venue name').fill(name)
  await page.getByLabel('Public address').fill('123 Example Street')
  await page
    .getByLabel('Description', { exact: true })
    .fill('Test community listing')
  await page.getByLabel('Latitude').fill('40')
  await page.getByLabel('Longitude').fill('-74')
  await page.getByRole('button', { name: 'Add menu item' }).click()
  await page.getByLabel('Item 1 name').fill('House dog')
  await page.getByLabel('Item 1 description').fill('Ask about availability')
  await page.getByRole('button', { name: 'Save private draft' }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Submit for review' }),
  ).toBeVisible()
  return new URL(page.url()).pathname
}

async function attachPhoto(page: Page) {
  const buffer = await page.screenshot({
    clip: { x: 0, y: 0, width: 16, height: 16 },
  })
  await page
    .getByLabel('Photo file')
    .setInputFiles({ name: '../../menu.png', mimeType: 'image/png', buffer })
  await page.getByLabel('Photo subject').selectOption({ label: 'House dog' })
  await page.getByRole('button', { name: 'Upload photo' }).click()
  await expect(page.getByRole('status')).toHaveText(
    'Photo attached to this private draft.',
  )
  const image = page.getByRole('img', { name: 'Community photo: House dog' })
  await expect(image).toBeVisible()
  expect(
    await image.evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0)
  return (await image.getAttribute('src'))!
}

test('keeps contributions and photos private, rejects disguised SVG, and supports withdrawal', async ({
  page,
  request,
}, info) => {
  await signIn(page, request, `directory-author-${info.project.name}`)
  const path = await draft(
    page,
    `Private suggestion ${info.project.name} ${Date.now()}`,
  )
  await page.getByLabel('Photo file').setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  })
  await page.getByRole('button', { name: 'Upload photo' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Choose a valid JPEG or PNG',
  )
  const photo = await attachPhoto(page)
  expect((await request.get(photo)).status()).toBe(404)
  expect((await request.get(`/api/v1${path}`)).status()).toBe(401)
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await expect(page.getByRole('status')).toContainText(
    'Awaiting site-owner review',
  )
  await expect(page.getByRole('button', { name: 'Upload photo' })).toHaveCount(
    0,
  )
  await page.getByRole('button', { name: 'Discard contribution' }).click()
  await expect(
    page.getByRole('heading', { name: 'Venue directory' }),
  ).toBeVisible()
  expect((await page.request.get(photo)).status()).toBe(404)
})

test('reviews, publishes, features, hides, and restores approved listings', async ({
  page,
  browser,
  request,
}, info) => {
  const container = process.env.E2E_DIRECTORY_DB_CONTAINER
  test.skip(
    !container,
    'Set E2E_DIRECTORY_DB_CONTAINER only for a disposable local Compose database.',
  )
  await signIn(page, request, `directory-publish-${info.project.name}`)
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(
    new URL(page.url()).hostname,
  )
  const name = `Reviewed stand ${info.project.name} ${Date.now()}`
  await draft(page, name)
  const photo = await attachPhoto(page)
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await expect(page.getByRole('status')).toContainText(
    'Awaiting site-owner review',
  )
  const origin = new URL(page.url()).origin
  const moderatorContext = await browser.newContext({
    baseURL: origin,
    viewport: page.viewportSize() ?? undefined,
  })
  const visitorContext = await browser.newContext({
    baseURL: origin,
    viewport: page.viewportSize() ?? undefined,
  })
  try {
    const moderator = await moderatorContext.newPage()
    await signIn(moderator, request, `directory-owner-${info.project.name}`)
    const session = (await (
      await moderator.request.get('/api/v1/auth/session')
    ).json()) as { user: { id: string } }
    expect(session.user.id).toMatch(/^[a-f0-9-]{36}$/)
    execFileSync(
      'docker',
      [
        'exec',
        container!,
        'psql',
        '-U',
        'glizzy',
        '-d',
        'glizzy_gauntlet',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `UPDATE app_users SET site_owner = TRUE WHERE id = '${session.user.id}'`,
      ],
      { stdio: 'pipe' },
    )
    await moderator.goto('/venues')
    await moderator.getByRole('button', { name: 'Review queue' }).click()
    await moderator.getByRole('link', { name, exact: true }).click()
    await expect(
      moderator.getByRole('button', { name: 'Discard contribution' }),
    ).toHaveCount(0)
    await moderator
      .getByLabel('Review reason')
      .fill('Confirmed address and menu')
    await moderator.getByRole('button', { name: 'Approve listing' }).click()
    await expect(
      moderator.getByText('Review: Confirmed address and menu'),
    ).toBeVisible()
    const visitor = await visitorContext.newPage()
    await visitor.goto('/venues')
    await visitor.getByRole('link', { name, exact: true }).click()
    await expect(
      visitor.getByRole('heading', { name, exact: true }),
    ).toBeVisible()
    expect((await visitor.request.get(photo)).status()).toBe(200)
    const venueId = new URL(visitor.url()).pathname.split('/').pop()!
    const sessionReply = (await (
      await page.request.get('/api/v1/auth/session')
    ).json()) as { csrfToken: string }
    const headers = { 'X-CSRF-TOKEN': sessionReply.csrfToken }
    const created = await page.request.post('/api/v1/competitions', {
      headers,
      data: {
        name: `Featured crew ${info.project.name}`,
        rules: '',
        visibility: 'PRIVATE',
        timeZone: 'UTC',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 172800000).toISOString(),
        allowSharedMeals: false,
      },
    })
    expect(created.status()).toBe(201)
    const competition = (await created.json()) as { id: string }
    await page.goto(`/competitions/${competition.id}`)
    await page.getByLabel('Approved venue to feature').selectOption(venueId)
    await page
      .getByRole('button', { name: 'Feature venue', exact: true })
      .click()
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
    expect(
      (
        await visitor.request.get(
          `/api/v1/competitions/${competition.id}/featured-venues`,
        )
      ).status(),
    ).toBe(404)
    await moderator
      .getByLabel('Visibility change reason')
      .fill('Listing needs another check')
    await moderator.getByRole('button', { name: 'Hide listing' }).click()
    await expect(moderator.getByRole('status')).toHaveText(
      'Visibility updated.',
    )
    await visitor.reload()
    await expect(visitor.getByRole('alert')).toContainText('unavailable')
    expect((await visitor.request.get(photo)).status()).toBe(404)
    await page.reload()
    await expect(page.getByText('No featured venues yet.')).toBeVisible()
    await moderator.getByRole('button', { name: 'Restore listing' }).click()
    await expect
      .poll(async () => (await visitor.request.get(photo)).status())
      .toBe(200)
    await visitor.goto('/venues')
    await visitor.route('https://tiles.openfreemap.org/**', (route) =>
      route.fulfill({
        json: { version: 8, sources: {}, layers: [] },
      }),
    )
    await visitor
      .getByRole('button', { name: 'Load map (external tiles)' })
      .click()
    await expect(
      visitor
        .getByRole('region', { name: 'Approved venue map' })
        .getByRole('button', { name, exact: true }),
    ).toBeVisible()
    await visitor.getByRole('button', { name: 'Hide map' }).click()
    await visitor.unroute('https://tiles.openfreemap.org/**')
    await visitor.route('https://tiles.openfreemap.org/**', (route) =>
      route.abort(),
    )
    await visitor
      .getByRole('button', { name: 'Load map (external tiles)' })
      .click()
    await expect(
      visitor.getByText(
        'Map unavailable. All venues are still in the list below.',
      ),
    ).toBeVisible()
    await expect(visitor.getByRole('link', { name, exact: true })).toBeVisible()
    expect(
      await visitor.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await moderatorContext.close()
    await visitorContext.close()
  }
})
