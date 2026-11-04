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
  const [inputBox, saveBox] = await Promise.all([
    page.getByLabel('Display name').boundingBox(),
    page.getByRole('button', { name: 'Save display name' }).boundingBox(),
  ])
  if (info.project.name === 'desktop') {
    expect(saveBox!.x).toBeGreaterThan(inputBox!.x + inputBox!.width)
    expect(
      Math.abs(
        saveBox!.y + saveBox!.height / 2 - inputBox!.y - inputBox!.height / 2,
      ),
    ).toBeLessThanOrEqual(1)
  } else {
    expect(saveBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height)
    expect(
      Math.abs(saveBox!.x + saveBox!.width - inputBox!.x - inputBox!.width),
    ).toBeLessThanOrEqual(1)
  }
  await page.getByLabel('Display name').fill('Pickle captain')
  await page.getByRole('button', { name: 'Save display name' }).click()
  await expect(page.getByRole('status')).toHaveText('Display name saved.')
  await page.reload()
  await expect(page.getByLabel('Display name')).toHaveValue('Pickle captain')
  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(
    navigation.getByRole('link', { name: 'My meals', exact: true }),
  ).toHaveCount(0)
  const tabs = page.getByRole('navigation', { name: 'Account navigation' })
  await expect(
    tabs.getByRole('link', { name: 'Profile settings' }),
  ).toHaveAttribute('aria-current', 'page')
  for (const [tab, heading, action] of [
    ['My venues', 'My venues', 'Suggest a venue'],
    ['My competitions', 'My competitions', 'Create a competition'],
    ['My feed', 'My meals', 'Log a meal'],
  ]) {
    await tabs.getByRole('link', { name: tab, exact: true }).click()
    await expect(
      page.getByRole('heading', { name: heading, level: 1 }),
    ).toBeVisible()
    const title = page.getByRole('heading', { name: heading, level: 1 })
    const header = title.locator('..')
    const primary = header.getByRole('link', { name: action, exact: true })
    await expect(primary).toBeVisible()
    const [headerBox, titleBox, actionBox] = await Promise.all([
      header.boundingBox(),
      title.boundingBox(),
      primary.boundingBox(),
    ])
    expect(
      Math.abs(
        headerBox!.x + headerBox!.width - actionBox!.x - actionBox!.width,
      ),
    ).toBeLessThanOrEqual(1)
    if (info.project.name === 'desktop') {
      expect(actionBox!.x).toBeGreaterThanOrEqual(titleBox!.x + titleBox!.width)
      expect(
        Math.abs(
          actionBox!.y +
            actionBox!.height / 2 -
            titleBox!.y -
            titleBox!.height / 2,
        ),
      ).toBeLessThanOrEqual(1)
    } else {
      expect(actionBox!.y).toBeGreaterThanOrEqual(
        titleBox!.y + titleBox!.height,
      )
    }
    await expect(
      tabs.getByRole('link', { name: tab, exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  }
  await expect(page.getByText('No saved meals here yet.')).toBeVisible()
  await page.getByRole('link', { name: 'Log a meal', exact: true }).click()
  await page.getByLabel('How many hot dogs?').fill('1')
  const saveMeal = page.getByRole('button', {
    name: 'Save meal and selected submissions',
  })
  await expect(saveMeal).toBeEnabled()
  expect(
    await saveMeal.evaluate((button) => {
      const parent = button.parentElement!
      const style = getComputedStyle(parent)
      return Math.abs(
        parent.getBoundingClientRect().right -
          parseFloat(style.paddingRight) -
          parseFloat(style.borderRightWidth) -
          button.getBoundingClientRect().right,
      )
    }),
  ).toBeLessThanOrEqual(1)
  await saveMeal.click()
  await expect(page).toHaveURL(/\/meals\/[a-f0-9-]{36}$/)
  await page.getByRole('link', { name: 'My meals', exact: true }).click()
  await expect(
    page.getByRole('link', { name: 'Hot dogs', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    tabs.getByRole('link', { name: 'My feed', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(
    page.getByRole('link', { name: 'Hot dogs', exact: true }),
  ).toBeVisible()
  await page.goto('/meals')
  await expect(page).toHaveURL(/\/account\/meals$/)
  await expect(
    tabs.getByRole('link', { name: 'My feed', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(
    page.getByRole('link', { name: 'Hot dogs', exact: true }),
  ).toBeVisible()
  await tabs.getByRole('link', { name: 'Profile settings' }).click()
  await expect(page.getByLabel('Display name')).toHaveValue('Pickle captain')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Sign in to your crew.' }),
  ).toBeVisible()
  await expect(tabs).toHaveCount(0)
  expect((await page.request.get('/api/v1/me')).status()).toBe(401)
  await page.goto(confirmation!)
  await expect(page.getByRole('alert')).toContainText(
    'invalid, expired, or already used',
  )
})
