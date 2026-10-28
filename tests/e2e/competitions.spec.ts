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
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm sign-in' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your account' }),
  ).toBeVisible()
}

async function draft(
  page: Page,
  name: string,
  visibility: 'PUBLIC' | 'PRIVATE',
) {
  await page.goto('/competitions/new')
  await page.getByLabel('Competition name').fill(name)
  await page
    .getByLabel('Written rules')
    .fill('Use actual measurements. Eat at your own pace.')
  await page.getByLabel('Visibility', { exact: true }).selectOption(visibility)
  await page.getByLabel('Competition time zone').fill('UTC')
  await page
    .getByLabel('Eating starts', { exact: true })
    .fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16))
  await page
    .getByLabel('Eating ends', { exact: true })
    .fill(new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 16))
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  return new URL(page.url()).pathname
}

test('protects private drafts, accepts explicit invitations, revokes links, and audits exclusion', async ({
  page,
  browser,
  request,
}, info) => {
  await signIn(page, request, `private-owner-${info.project.name}`)
  const name = `Private crew ${info.project.name} ${Date.now()}`
  const path = await draft(page, name, 'PRIVATE')
  const guest = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize() ?? undefined,
  })
  const other = await guest.newPage()
  try {
    await other.goto(path)
    await expect(other.getByRole('alert')).toContainText(
      'unavailable or private',
    )
    await page.getByRole('button', { name: 'Publish competition' }).click()
    await expect(
      page.getByRole('button', { name: 'Create invitation' }),
    ).toBeEnabled()
    await page.getByRole('button', { name: 'Create invitation' }).click()
    const field = page.getByLabel('New invitation link')
    await expect(field).toBeVisible()
    const invitation = await field.inputValue()
    await other.goto(invitation)
    await expect(
      other.getByRole('heading', { name, exact: true }),
    ).toBeVisible()
    await expect(other).toHaveURL(/\/join$/)
    expect((await other.request.get(`/api/v1${path}`)).status()).toBe(404)
    await signIn(other, request, `private-member-${info.project.name}`)
    await other.getByLabel('Display name').fill('Crew mate')
    await other.getByRole('button', { name: 'Save display name' }).click()
    await expect(other.getByRole('status')).toHaveText('Display name saved.')
    await other.goto(invitation)
    await other.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(
      other.getByRole('heading', { name: 'Members', exact: true }),
    ).toBeVisible()
    await expect(other.getByText('2 joined', { exact: true })).toBeVisible()
    await page.reload()
    await page
      .getByRole('button', { name: 'Revoke invitation', exact: true })
      .click()
    await expect(page.getByText(/Revoked/)).toBeVisible()
    await other.goto(invitation)
    await expect(other.getByRole('alert')).toContainText(
      'invalid, revoked, expired, or closed',
    )
    await other.goto(path)
    await expect(
      other.getByRole('heading', { name: 'Members', exact: true }),
    ).toBeVisible()
    await page
      .getByLabel('Exclusion reason for Crew mate')
      .fill('Organizer decision')
    await page.getByRole('button', { name: 'Exclude participant' }).click()
    await expect(page.getByText(/Participant \/ Excluded/)).toBeVisible()
    await other.reload()
    await expect(other.getByRole('alert')).toContainText(
      'unavailable or private',
    )
    await page.getByRole('button', { name: 'Create invitation' }).click()
    const next = page.getByLabel('New invitation link')
    await expect(next).toBeVisible()
    await other.goto(await next.inputValue())
    await other.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(other.getByRole('alert')).toContainText(
      'excluded this account',
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await guest.close()
  }
})

test('discovers public competitions, joins as a member, and limits settings to the organizer', async ({
  page,
  browser,
  request,
}, info) => {
  await signIn(page, request, `public-owner-${info.project.name}`)
  const name = `Public crew ${info.project.name} ${Date.now()}`
  const path = await draft(page, name, 'PUBLIC')
  await page.getByRole('button', { name: 'Publish competition' }).click()
  await expect(
    page.getByRole('button', { name: 'Create invitation' }),
  ).toBeEnabled()
  const guest = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize() ?? undefined,
  })
  const other = await guest.newPage()
  try {
    await other.goto('/competitions')
    await other.getByRole('link', { name, exact: true }).click()
    await expect(
      other.getByRole('heading', { name: 'Members', exact: true }),
    ).toHaveCount(0)
    await signIn(other, request, `public-member-${info.project.name}`)
    await other.goto(path)
    await other
      .getByRole('button', { name: 'Join competition', exact: true })
      .click()
    await expect(
      other.getByRole('heading', { name: 'Members', exact: true }),
    ).toBeVisible()
    await expect(
      other.getByRole('link', { name: 'Edit settings' }),
    ).toHaveCount(0)
    const session = (await (
      await other.request.get('/api/v1/auth/session')
    ).json()) as { csrfToken: string }
    const forged = await other.request.post(`/api/v1${path}/publish`, {
      headers: { 'X-CSRF-TOKEN': session.csrfToken },
      data: { version: 1 },
    })
    expect(forged.status()).toBe(403)
    await page.getByRole('link', { name: 'Edit settings' }).click()
    await page
      .getByLabel('Written rules')
      .fill('Measured lengths only. Take your time.')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page).toHaveURL(new URL(path, page.url()).href)
    await expect(
      page.getByText('Measured lengths only. Take your time.', { exact: true }),
    ).toBeVisible()
    await other.reload()
    await expect(
      other.getByText('Measured lengths only. Take your time.', {
        exact: true,
      }),
    ).toBeVisible()
    expect(
      await other.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await guest.close()
  }
})
