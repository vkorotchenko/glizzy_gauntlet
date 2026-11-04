import { expect, test } from '@playwright/test'

test('shows public competition discovery and a private-feed sign-in prompt', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', {
      name: 'Your feed starts here.',
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Explore public competitions' }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Sign in to see your feed' }),
  ).toHaveAttribute('href', '/sign-in')
  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(
    navigation.getByRole('link', { name: 'Feed', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  expect(
    await navigation
      .getByRole('link', { name: 'Feed', exact: true })
      .evaluate((link) => getComputedStyle(link, '::after').height),
  ).toBe('3px')
  await expect(
    page.getByRole('region', { name: 'Sample feed' }).getByRole('img'),
  ).toHaveCount(2)
  await expect(
    navigation.getByRole('link', { name: 'Venues', exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole('link', { name: 'Start a competition', exact: true })
    .click()
  await expect(
    page.getByRole('table', { name: 'Example competition standings' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'From idea to leaderboard' }),
  ).toHaveCount(0)
  await page.getByRole('link', { name: 'View competitions' }).click()
  await expect(
    page.getByRole('heading', { name: 'Competitions', level: 1 }),
  ).toBeVisible()
  await navigation.getByRole('link', { name: 'Feed', exact: true }).click()
  await page
    .getByRole('link', { name: 'Log in or create an account', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Your seat at the table' }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Sign in or create your account' }),
  ).toHaveAttribute('href', '/sign-in')
  await navigation
    .getByRole('link', { name: 'Competitions', exact: true })
    .click()
  await expect(
    navigation.getByRole('link', { name: 'Competitions', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(
    navigation.getByRole('link', { name: 'Feed', exact: true }),
  ).not.toHaveAttribute('aria-current', 'page')
  expect((await request.get('/api/v1/status')).ok()).toBe(true)
  expect((await request.get('/api/v1/feed')).status()).toBe(401)
  expect((await request.get('/api/v1/venues')).status()).toBe(401)
  await expect(
    page.getByRole('heading', { name: 'My competitions', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Public competitions' }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('keeps sign-in available and retries public competition loading', async ({
  page,
}) => {
  const endpoint = /\/api\/v1\/competitions\?/
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 503, json: { error: 'API_UNAVAILABLE' } }),
  )
  await page.goto('/')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Sign in to see your feed' }),
  ).toBeVisible()
  await page.unroute(endpoint)
  await page.getByRole('button', { name: 'Try competitions again' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('handles client routes without exposing management endpoints', async ({
  page,
  request,
}) => {
  await page.goto('/not-on-the-menu')
  await expect(
    page.getByRole('heading', { name: 'This spot is not on the menu.' }),
  ).toBeVisible()
  const internal = await request.get('/actuator/health')
  expect(internal.status()).toBe(404)
  expect(internal.headers()['content-type']).toContain('application/json')
})
