import { execFileSync } from 'node:child_process'
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import type { components } from '../../packages/api-client/src/schema'

type Meal = components['schemas']['Meal']
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
      ).json()) as { messages: { ID: string; To: { Address: string }[] }[] }
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
  await expect(page.getByLabel('Display name')).toBeVisible()
}
async function headers(page: Page) {
  const session = (await (
    await page.request.get('/api/v1/auth/session')
  ).json()) as { csrfToken: string }
  return { 'X-CSRF-TOKEN': session.csrfToken }
}
async function fillMeal(page: Page, eatenAt = new Date(Date.now() - 3600000)) {
  await page.goto('/meals/new')
  await page.getByLabel('Eating time zone').fill('UTC')
  await page.getByLabel('When you ate').fill(eatenAt.toISOString().slice(0, 16))
  await page.getByLabel('Item 1 name').fill('Measured house dog')
  await page.getByLabel('Item 1 whole quantity').fill('2')
  await page.getByLabel('Item 1 full length (inches)').fill('8')
  await page.getByLabel('Item 1 additional partial inches').fill('3')
  await page.getByLabel('Private location label').fill('Private picnic')
}
async function photo(page: Page) {
  const buffer = await page.screenshot({
    clip: { x: 0, y: 0, width: 16, height: 16 },
  })
  await page
    .getByLabel('Meal photo file')
    .setInputFiles({ name: 'meal.png', mimeType: 'image/png', buffer })
  await page.getByRole('button', { name: 'Upload private photo' }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Attach photo 1' }),
  ).toBeChecked()
  return (await page
    .getByRole('img', { name: 'Available meal photo 1' })
    .getAttribute('src'))!
}
async function save(page: Page) {
  await page
    .getByRole('button', { name: 'Save meal and selected submissions' })
    .click()
  await expect(page).toHaveURL(/\/meals\/[a-f0-9-]{36}$/)
  await expect(page.getByRole('heading', { name: 'Meal record' })).toBeVisible()
  const path = new URL(page.url()).pathname
  return (await (await page.request.get(`/api/v1${path}`)).json()) as Meal
}

test('records exact inches privately, rejects extra precision, and archives without erasing history', async ({
  page,
  browser,
  request,
}, info) => {
  await signIn(page, request, `meal-private-${info.project.name}`)
  await fillMeal(page)
  await page.getByLabel('Item 1 full length (inches)').fill('8.001')
  await page
    .getByRole('button', { name: 'Save meal and selected submissions' })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'at most two decimal places',
  )
  await page.getByLabel('Item 1 full length (inches)').fill('8')
  const image = await photo(page)
  const meal = await save(page)
  expect(meal.revision.totalHundredths).toBe(1900)
  expect(meal.revision.wholeHotDogs).toBe(2)
  expect(meal.submissions).toEqual([])
  await expect(
    page.getByText('Not submitted to any competition.'),
  ).toBeVisible()
  expect((await request.get(image)).status()).toBe(401)
  const guest = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  })
  try {
    const other = await guest.newPage()
    await signIn(other, request, `meal-outsider-${info.project.name}`)
    expect((await other.request.get(`/api/v1/meals/${meal.id}`)).status()).toBe(
      404,
    )
    expect((await other.request.get(image)).status()).toBe(404)
    await page
      .getByRole('button', { name: 'Archive source (keep submissions)' })
      .click()
    await expect(
      page.getByText('Private source / Revision 1 / Archived'),
    ).toBeVisible()
    await page
      .getByRole('link', { name: 'My meals', exact: true })
      .last()
      .click()
    await expect(page.getByText('No saved meals here yet.')).toBeVisible()
    await page.getByRole('button', { name: 'Show archived sources' }).click()
    await expect(
      page.getByRole('link', { name: 'Measured house dog' }),
    ).toBeVisible()
    expect((await page.request.get(image)).status()).toBe(200)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await guest.close()
  }
})

test('shares explicit snapshots, preserves a closed competition, and revokes photo access on withdrawal', async ({
  page,
  browser,
  request,
}, info) => {
  const container = process.env.E2E_TEST_DB_CONTAINER
  test.skip(
    !container,
    'Set E2E_TEST_DB_CONTAINER only for a disposable local Compose database.',
  )
  await signIn(page, request, `meal-share-${info.project.name}`)
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(
    new URL(page.url()).hostname,
  )
  const csrf = await headers(page)
  const competitions: { id: string; name: string; inviteUrl: string }[] = []
  for (const suffix of ['A', 'B']) {
    const name = `Meal crew ${suffix} ${info.project.name} ${Date.now()}`
    const create = await page.request.post('/api/v1/competitions', {
      headers: csrf,
      data: {
        name,
        rules: 'Use measured lengths.',
        visibility: 'PRIVATE',
        timeZone: 'UTC',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 172800000).toISOString(),
        allowSharedMeals: true,
      },
    })
    expect(create.status()).toBe(201)
    const draft = (await create.json()) as { id: string; version: number }
    expect(
      (
        await page.request.post(`/api/v1/competitions/${draft.id}/publish`, {
          headers: csrf,
          data: { version: draft.version },
        })
      ).ok(),
    ).toBe(true)
    const invite = (await (
      await page.request.post(`/api/v1/competitions/${draft.id}/invitations`, {
        headers: csrf,
      })
    ).json()) as { inviteUrl: string }
    competitions.push({ id: draft.id, name, inviteUrl: invite.inviteUrl })
  }
  const [a, b] = competitions
  for (const competition of competitions) {
    expect(competition.id).toMatch(/^[a-f0-9-]{36}$/)
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
        `UPDATE competitions SET starts_at = date_trunc('milliseconds', clock_timestamp()) - interval '48 hours', ends_at = date_trunc('milliseconds', clock_timestamp()) + interval '1 hour' WHERE id = '${competition.id}'`,
      ],
      { stdio: 'pipe' },
    )
  }
  const memberContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize() ?? undefined,
  })
  try {
    const member = await memberContext.newPage()
    await signIn(member, request, `meal-member-${info.project.name}`)
    await member.goto(a.inviteUrl)
    await member.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(
      member.getByRole('heading', { name: 'Members', exact: true }),
    ).toBeVisible()
    await fillMeal(page, new Date(Date.now() - 25 * 3600000))
    const image = await photo(page)
    const targetA = page.getByRole('checkbox', {
      name: `Submit to ${a.name}`,
      exact: true,
    })
    const targetB = page.getByRole('checkbox', {
      name: `Submit to ${b.name}`,
      exact: true,
    })
    await expect(targetA).not.toBeChecked()
    await targetA.check()
    await targetB.check()
    let meal = await save(page)
    expect(meal.submissions).toHaveLength(2)
    expect((await member.request.get(image)).status()).toBe(200)
    expect(
      (await member.request.get(`/api/v1/competitions/${b.id}/meals`)).status(),
    ).toBe(404)
    await member.reload()
    const activity = member
      .getByRole('heading', { name: 'Member meal activity' })
      .locator('..')
    await expect(activity.getByText('19.00 inches')).toBeVisible()
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
        `UPDATE competitions SET ends_at = date_trunc('milliseconds', clock_timestamp()) - interval '24 hours' WHERE id = '${b.id}'`,
      ],
      { stdio: 'pipe' },
    )
    await page
      .getByRole('link', { name: 'Edit meal or select submissions' })
      .click()
    await expect(
      page.getByRole('checkbox', { name: `Submit to ${a.name}`, exact: true }),
    ).not.toBeChecked()
    await page.getByLabel('Item 1 additional partial inches').fill('1')
    meal = await save(page)
    expect(meal.revision.totalHundredths).toBe(1700)
    expect(meal.submissions.map((item) => item.totalHundredths)).toEqual([
      1900, 1900,
    ])
    await page
      .getByRole('link', { name: 'Edit meal or select submissions' })
      .click()
    await page
      .getByRole('checkbox', { name: `Submit to ${a.name}`, exact: true })
      .check()
    meal = await save(page)
    expect(
      meal.submissions.find((item) => item.competitionId === a.id)
        ?.totalHundredths,
    ).toBe(1700)
    expect(
      meal.submissions.find((item) => item.competitionId === b.id)
        ?.totalHundredths,
    ).toBe(1900)
    await expect(
      page.getByRole('button', { name: `Withdraw from ${b.name}` }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: `Withdraw from ${a.name}` }).click()
    await expect
      .poll(async () => (await member.request.get(image)).status())
      .toBe(404)
    await member.reload()
    await expect(member.getByText('No submitted meals yet.')).toBeVisible()
    await page
      .getByRole('button', { name: 'Archive source (keep submissions)' })
      .click()
    await expect(
      page.getByText('Private source / Revision 3 / Archived'),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await memberContext.close()
  }
})
