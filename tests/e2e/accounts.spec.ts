import { expect, test } from '@playwright/test'

test('confirms an email, persists a profile, signs out, and rejects token reuse', async ({
  page,
  request,
}, info) => {
  const email = `diner-${info.project.name}-${Date.now()}@example.test`
  const mailbox = process.env.MAILPIT_BASE_URL ?? 'http://127.0.0.1:8025'
  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByRole('status')).toContainText(
    'If delivery is available',
  )

  let messageId = ''
  await expect
    .poll(async () => {
      const response = await request.get(`${mailbox}/api/v1/messages`)
      const inbox = (await response.json()) as {
        messages: { ID: string; To: { Address: string }[] }[]
      }
      messageId =
        inbox.messages.find((message) =>
          message.To.some((to) => to.Address === email),
        )?.ID ?? ''
      return messageId
    })
    .not.toBe('')
  const delivered = await request.get(`${mailbox}/api/v1/message/${messageId}`)
  const message = (await delivered.json()) as { Text: string }
  const confirmation = message.Text.match(
    /https?:\/\/\S+\/sign-in\/confirm\?token=[A-Za-z0-9_-]{43}/,
  )?.[0]
  expect(confirmation).toBeTruthy()
  await page.goto(confirmation!)
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/sign-in\/confirm$/)
  expect((await page.request.get('/api/v1/me')).status()).toBe(401)
  await page.getByRole('button', { name: 'Confirm sign-in' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your account' }),
  ).toBeVisible()
  await page.getByLabel('Display name').fill('Pickle captain')
  await page.getByRole('button', { name: 'Save display name' }).click()
  await expect(page.getByRole('status')).toHaveText('Display name saved.')
  await page.reload()
  await expect(page.getByLabel('Display name')).toHaveValue('Pickle captain')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Sign in to your crew.' }),
  ).toBeVisible()
  expect((await page.request.get('/api/v1/me')).status()).toBe(401)
  await page.goto(confirmation!)
  await expect(page.getByRole('alert')).toContainText(
    'invalid, expired, or already used',
  )
})
