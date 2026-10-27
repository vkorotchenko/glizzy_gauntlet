import { expect, test } from '@playwright/test'

test('connects the browser to the real API and database', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Every inch has a story.' }),
  ).toBeVisible()
  await expect(page.getByText('API and database connected')).toBeVisible()
  await page.getByRole('link', { name: 'See the game plan' }).click()
  await expect(page).toHaveURL(/#how-it-works$/)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('shows an honest error and supports retrying a failed API connection', async ({
  page,
}) => {
  await page.route('**/api/v1/status', (route) =>
    route.fulfill({ status: 503, json: { status: 'DOWN' } }),
  )
  await page.goto('/')
  await expect(page.getByText('API unavailable')).toBeVisible()
  await page.unroute('**/api/v1/status')
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByText('API and database connected')).toBeVisible()
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
