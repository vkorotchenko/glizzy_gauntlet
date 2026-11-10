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
  const local = await page.evaluate((instant) => {
    const date = new Date(instant)
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16)
  }, eatenAt.toISOString())
  await expect(page.getByLabel('Eating time zone')).toHaveCount(0)
  await expect(page.getByLabel('Repeated hour')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Save meal and selected submissions' }),
  ).toBeEnabled()
  await page
    .getByRole('checkbox', { name: 'Share with all eligible competitions' })
    .uncheck()
  if (!(await page.getByLabel('Inches for hot dog 1').count()))
    await page.getByLabel('Include inches').check()
  await page.getByLabel('Inches for hot dog 1').fill('9.5')
  await page.getByRole('button', { name: 'Duplicate hot dog 1' }).click()
  await page.getByRole('radio', { name: 'Somewhere else' }).check()
  await page.getByLabel('Meal date', { exact: true }).fill(local.slice(0, 10))
  await page.getByLabel('Meal time', { exact: true }).fill(local.slice(11, 16))
  await page
    .getByLabel('Private location label', { exact: true })
    .fill('Private picnic')
}
async function photo(page: Page) {
  const buffer = await page.screenshot({
    clip: { x: 0, y: 0, width: 16, height: 16 },
  })
  await page
    .getByLabel('Add photos (up to 3)')
    .setInputFiles({ name: 'meal.png', mimeType: 'image/png', buffer })
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
  const session = (await (
    await page.request.get('/api/v1/auth/session')
  ).json()) as { csrfToken: string }
  expect(
    (
      await page.request.post(
        '/api/v1/competitions/00000000-0000-4000-8000-000000000000/leave',
        {
          headers: { 'X-CSRF-TOKEN': session.csrfToken },
        },
      )
    ).status(),
  ).toBe(200)
  await fillMeal(page)
  await page.getByLabel('Inches for hot dog 1').fill('9.501')
  await page
    .getByRole('button', { name: 'Save meal and selected submissions' })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'at most two decimal places',
  )
  await page.getByLabel('Inches for hot dog 1').fill('9.5')
  const image = await photo(page)
  const meal = await save(page)
  expect(new Date(meal.revision.eatenAt).getUTCMinutes() % 15).toBe(0)
  expect(new Date(meal.revision.eatenAt).getUTCSeconds()).toBe(0)
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
      page.getByRole('link', { name: 'Hotdog', exact: true }),
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

test('logs count-only meals without optional details and unions measurements across competitions', async ({
  page,
  request,
}, info) => {
  const container = process.env.E2E_TEST_DB_CONTAINER
  test.skip(!container, 'Requires an explicitly allowed disposable database.')
  await signIn(page, request, `simple-meal-${info.project.name}`)
  const csrf = await headers(page)
  const createActive = async (trackingMode: 'COUNT' | 'LENGTH') => {
    const name = `Simple ${trackingMode} ${info.project.name} ${Date.now()}`
    const created = await page.request.post('/api/v1/competitions', {
      headers: csrf,
      data: {
        name,
        rules: '',
        visibility: 'PRIVATE',
        timeZone: 'UTC',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 172800000).toISOString(),
        allowSharedMeals: true,
        trackingMode,
      },
    })
    expect(created.status()).toBe(201)
    const draft = (await created.json()) as { id: string; version: number }
    expect(
      (
        await page.request.post(`/api/v1/competitions/${draft.id}/publish`, {
          headers: csrf,
          data: { version: draft.version },
        })
      ).ok(),
    ).toBe(true)
    expect(draft.id).toMatch(/^[a-f0-9-]{36}$/)
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
        `UPDATE competitions SET starts_at = clock_timestamp() - interval '2 hours', ends_at = clock_timestamp() + interval '1 hour' WHERE id = '${draft.id}'`,
      ],
      { stdio: 'pipe' },
    )
    return { ...draft, name }
  }
  const count = await createActive('COUNT')
  await page.goto('/meals/new')
  await page
    .getByRole('checkbox', { name: 'Share with all eligible competitions' })
    .uncheck()
  const target = page.getByRole('checkbox', {
    name: `Submit to ${count.name}`,
    exact: true,
  })
  await expect(target).toBeVisible()
  await expect(page.getByLabel('Inches for hot dog 1')).toHaveCount(0)
  await expect(page.getByLabel('Meal date', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Meal time', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Private location label')).toBeHidden()
  await page.getByRole('button', { name: 'Add hot dog' }).click()
  await page.getByRole('button', { name: 'Add hot dog' }).click()
  await target.check()
  const loggedAt = Date.now()
  const meal = await save(page)
  expect(meal.revision.wholeHotDogs).toBe(3)
  expect(meal.revision.totalHundredths).toBe(0)
  expect(meal.revision.location).toBe('Home')
  expect(meal.revision.photoIds).toEqual([])
  expect(meal.revision.items).toHaveLength(3)
  expect(Date.parse(meal.revision.eatenAt)).toBeGreaterThanOrEqual(
    loggedAt - 1000,
  )
  await page.goto(`/competitions/${count.id}`)
  const standings = page.getByRole('table', { name: 'Provisional standings' })
  await expect(
    standings.getByRole('columnheader', { name: 'Whole hot dogs' }),
  ).toBeVisible()
  await expect(
    standings.getByRole('columnheader', { name: 'Inches' }),
  ).toHaveCount(0)
  await page.goto(`/competitions/${count.id}/progress`)
  await expect(page.getByRole('img', { name: /Daily hot dogs/ })).toBeVisible()

  const length = await createActive('LENGTH')
  await page.goto('/meals/new')
  await page
    .getByRole('checkbox', { name: 'Share with all eligible competitions' })
    .uncheck()
  await page.getByLabel('Inches for hot dog 1').fill('7.75')
  await page.getByRole('button', { name: 'Duplicate hot dog 1' }).click()
  await page
    .getByRole('checkbox', { name: `Submit to ${count.name}`, exact: true })
    .check()
  await page
    .getByRole('checkbox', { name: `Submit to ${length.name}`, exact: true })
    .check()
  const shared = await save(page)
  expect(shared.submissions).toHaveLength(2)
  expect(shared.revision.totalHundredths).toBe(1550)
  expect(shared.revision.wholeHotDogs).toBe(2)
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
    // Keep this feed independent of parallel all-time competition submissions.
    expect(
      (
        await member.request.post(
          '/api/v1/competitions/00000000-0000-4000-8000-000000000000/leave',
          { headers: await headers(member) },
        )
      ).status(),
    ).toBe(200)
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
    await member.goto('/')
    const feed = member.getByRole('article')
    await expect(feed).toHaveCount(1)
    await expect(
      feed.getByRole('link', { name: a.name, exact: true }),
    ).toBeVisible()
    await expect(feed.getByText('19.00 inches')).toBeVisible()
    await expect(feed.getByRole('img', { name: 'Meal photo 1' })).toBeVisible()
    const footer = feed.getByRole('group', { name: 'Meal totals and likes' })
    await expect(footer.getByText('2 hot dogs', { exact: true })).toBeVisible()
    await expect(footer.getByText('0 likes')).toBeVisible()
    await footer.getByRole('button', { name: 'Like', exact: true }).click()
    await expect(
      footer.getByRole('button', { name: 'Liked', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(footer.getByText('1 like')).toBeVisible()
    await member.reload()
    await expect(footer.getByText('1 like')).toBeVisible()
    await footer.getByRole('button', { name: 'Liked', exact: true }).click()
    await expect(footer.getByText('0 likes')).toBeVisible()
    expect(
      await member.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await member.goto(`/competitions/${a.id}`)
    const activity = member.getByRole('region', {
      name: 'Member meal activity',
    })
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
    await page
      .getByRole('checkbox', { name: 'Share with all eligible competitions' })
      .uncheck()
    await expect(
      page.getByRole('checkbox', { name: `Submit to ${a.name}`, exact: true }),
    ).not.toBeChecked()
    await page.getByLabel('Inches for hot dog 1').fill('7.5')
    meal = await save(page)
    expect(meal.revision.totalHundredths).toBe(1700)
    expect(meal.submissions.map((item) => item.totalHundredths)).toEqual([
      1900, 1900,
    ])
    await page
      .getByRole('link', { name: 'Edit meal or select submissions' })
      .click()
    await page
      .getByRole('checkbox', { name: 'Share with all eligible competitions' })
      .uncheck()
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
    await member.goto('/')
    await expect(member.getByText('Your feed is quiet for now.')).toBeVisible()
    await expect(
      member.getByRole('region', { name: 'Sample feed' }).getByRole('article'),
    ).toHaveCount(2)
    await expect(
      member.getByRole('button', { name: 'Like', exact: true }),
    ).toHaveCount(0)
    await expect(member.getByText('19.00 inches')).toHaveCount(0)
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
