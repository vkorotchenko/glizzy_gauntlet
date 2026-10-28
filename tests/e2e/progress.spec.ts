import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import type { components } from '../../packages/api-client/src/schema'

type Meal = components['schemas']['Meal']
type Competition = components['schemas']['Competition']
async function signIn(
  page: Page,
  request: APIRequestContext,
  tag: string,
  name: string,
) {
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
  await page.getByLabel('Display name').fill(name)
  await page.getByRole('button', { name: 'Save display name' }).click()
  await expect(page.getByRole('status')).toHaveText('Display name saved.')
}
async function write<T>(
  page: Page,
  path: string,
  data: unknown,
  status = 200,
  method: 'post' | 'put' = 'post',
) {
  const session = (await (
    await page.request.get('/api/v1/auth/session')
  ).json()) as { csrfToken: string }
  const response = await page.request[method](path, {
    headers: { 'X-CSRF-TOKEN': session.csrfToken },
    data,
  })
  expect(response.status()).toBe(status)
  return (await response.json()) as T
}

test('shows tied standings, private snapshot progress, and finalized scores without public activity leaks', async ({
  page,
  browser,
  request,
}, info) => {
  const container = process.env.E2E_TEST_DB_CONTAINER
  test.skip(
    !container,
    'Set E2E_TEST_DB_CONTAINER only for a disposable local Compose database.',
  )
  await page.goto('/')
  const origin = new URL(page.url()).origin
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(
    new URL(origin).hostname,
  )
  await signIn(
    page,
    request,
    `progress-owner-${info.project.name}`,
    'Score captain',
  )
  const competitions: Competition[] = []
  for (const visibility of ['PUBLIC', 'PRIVATE']) {
    let competition = await write<Competition>(
      page,
      '/api/v1/competitions',
      {
        name: `${visibility} progress ${info.project.name} ${Date.now()}`,
        rules: 'Use measured lengths.',
        visibility,
        timeZone: 'America/New_York',
        allowSharedMeals: true,
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 172800000).toISOString(),
      },
      201,
    )
    competition = await write<Competition>(
      page,
      `/api/v1/competitions/${competition.id}/publish`,
      { version: competition.version },
    )
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
    competitions.push(competition)
  }
  const [a, b] = competitions
  const content = {
    eatenAt: new Date(Date.now() - 25 * 3600000).toISOString(),
    venueId: null,
    location: 'Secret picnic',
    notes: 'Private snapshot note',
    items: [
      {
        name: 'Measured house dog',
        wholeQuantity: 2,
        unitHundredths: 800,
        partialHundredths: 300,
      },
    ],
    photoIds: [],
  }
  let meal = await write<Meal>(
    page,
    '/api/v1/meals',
    {
      requestId: randomUUID(),
      version: 0,
      content,
      competitionIds: [a.id, b.id],
    },
    201,
  )
  const memberContext = await browser.newContext({
    baseURL: origin,
    viewport: page.viewportSize() ?? undefined,
  })
  const zeroContext = await browser.newContext({
    baseURL: origin,
    viewport: page.viewportSize() ?? undefined,
  })
  const visitorContext = await browser.newContext({
    baseURL: origin,
    viewport: page.viewportSize() ?? undefined,
  })
  try {
    const member = await memberContext.newPage()
    await signIn(
      member,
      request,
      `progress-member-${info.project.name}`,
      'Score partner',
    )
    await write(member, `/api/v1/competitions/${a.id}/join`, {})
    await write(
      member,
      '/api/v1/meals',
      {
        requestId: randomUUID(),
        version: 0,
        content: {
          ...content,
          location: 'Partner private spot',
          items: [
            {
              name: 'Measured dog',
              wholeQuantity: 1,
              unitHundredths: 1900,
              partialHundredths: 0,
            },
          ],
        },
        competitionIds: [a.id],
      },
      201,
    )
    const zero = await zeroContext.newPage()
    await signIn(
      zero,
      request,
      `progress-zero-${info.project.name}`,
      'No meals yet',
    )
    await write(zero, `/api/v1/competitions/${a.id}/join`, {})
    await page.goto(`/competitions/${a.id}`)
    const standings = page.getByRole('table', { name: 'Provisional standings' })
    await expect(
      standings.getByRole('row', { name: '1 Score captain 19.00 2' }),
    ).toBeVisible()
    await expect(
      standings.getByRole('row', { name: '1 Score partner 19.00 1' }),
    ).toBeVisible()
    await expect(
      standings.getByRole('row', { name: '3 No meals yet 0.00 0' }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'My competition progress' }).click()
    const totals = page.getByLabel('Your competition totals')
    await expect(totals.getByText('19.00', { exact: true })).toBeVisible()
    await expect(totals.getByText('1 (ties share a rank)')).toBeVisible()
    await expect(
      page.getByRole('img', { name: /Daily inches in America\/New_York/ }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Cumulative chart' }).click()
    await expect(
      page.getByRole('img', { name: /Cumulative inches in America\/New_York/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('table', { name: 'Exact daily and cumulative totals' }),
    ).toBeVisible()
    const shared = (await (
      await page.request.get(`/api/v1/competitions/${b.id}/progress`)
    ).json()) as components['schemas']['PersonalProgress']
    expect(shared.totalHundredths).toBe(1900)
    expect(shared.mealCount).toBe(1)
    expect(
      (
        await member.request.get(`/api/v1/competitions/${b.id}/progress`)
      ).status(),
    ).toBe(404)
    const visitor = await visitorContext.newPage()
    await visitor.goto(`/competitions/${a.id}`)
    await expect(
      visitor.getByRole('table', { name: 'Provisional standings' }),
    ).toBeVisible()
    await expect(visitor.getByText('Secret picnic')).toHaveCount(0)
    await expect(
      visitor.getByRole('heading', { name: 'Member meal activity' }),
    ).toHaveCount(0)
    await expect(
      visitor.getByRole('link', { name: 'My competition progress' }),
    ).toHaveCount(0)
    const publicResponse = await visitor.request.get(
      `/api/v1/competitions/${a.id}/standings`,
    )
    expect(publicResponse.headers()['cache-control']).toBe('no-store')
    const publicData =
      (await publicResponse.json()) as components['schemas']['Standings']
    expect(Object.keys(publicData.items[0]).sort()).toEqual([
      'displayName',
      'rank',
      'totalHundredths',
      'wholeHotDogs',
    ])
    expect(JSON.stringify(publicData)).not.toContain('Secret picnic')
    expect(
      (
        await visitor.request.get(`/api/v1/competitions/${a.id}/progress`)
      ).status(),
    ).toBe(401)
    expect(
      (
        await visitor.request.get(`/api/v1/competitions/${b.id}/standings`)
      ).status(),
    ).toBe(404)
    const edited = {
      ...content,
      items: [{ ...content.items[0], partialHundredths: 100 }],
    }
    meal = await write<Meal>(
      page,
      `/api/v1/meals/${meal.id}`,
      {
        requestId: randomUUID(),
        version: meal.version,
        content: edited,
        competitionIds: [],
      },
      200,
      'put',
    )
    await page.reload()
    await expect(totals.getByText('19.00', { exact: true })).toBeVisible()
    meal = await write<Meal>(
      page,
      `/api/v1/meals/${meal.id}`,
      {
        requestId: randomUUID(),
        version: meal.version,
        content: edited,
        competitionIds: [a.id],
      },
      200,
      'put',
    )
    await page.reload()
    await expect(totals.getByText('17.00', { exact: true })).toBeVisible()
    await expect(totals.getByText('2 (ties share a rank)')).toBeVisible()
    await write(page, `/api/v1/meals/${meal.id}/archive`, {
      requestId: randomUUID(),
      version: meal.version,
    })
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
        `UPDATE competitions SET ends_at = date_trunc('milliseconds', clock_timestamp()) - interval '24 hours' WHERE id = '${a.id}'`,
      ],
      { stdio: 'pipe' },
    )
    expect(
      (await page.request.get(`/api/v1/competitions/${a.id}/recap`)).status(),
    ).toBe(200)
    await page.reload()
    await expect(totals.getByText('17.00', { exact: true })).toBeVisible()
    await expect(
      page.getByText(/Final progress from the latest recap revision/),
    ).toBeVisible()
    const unchanged = (await (
      await page.request.get(`/api/v1/competitions/${b.id}/progress`)
    ).json()) as components['schemas']['PersonalProgress']
    expect(unchanged.totalHundredths).toBe(1900)
    expect(unchanged.mealCount).toBe(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.getByRole('link', { name: 'Back to competition' }).click()
    await expect(page.getByText('Final results / Public')).toBeVisible()
    await expect(
      page.getByText(
        'Final standings from the latest final or revised recap. Earlier result revisions remain available.',
      ),
    ).toBeVisible()
  } finally {
    await memberContext.close()
    await zeroContext.close()
    await visitorContext.close()
  }
})
