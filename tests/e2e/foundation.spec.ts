import { expect, test } from '@playwright/test'

test('shows public competition discovery and a private-feed sign-in prompt', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', {
      name: "Your crew's next chapter starts here.",
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Explore public competitions' }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Sign in to see your feed' }),
  ).toHaveAttribute('href', '/sign-in')
  expect((await request.get('/api/v1/status')).ok()).toBe(true)
  expect((await request.get('/api/v1/feed')).status()).toBe(401)
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
