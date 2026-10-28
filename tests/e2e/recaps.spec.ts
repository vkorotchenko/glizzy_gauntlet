import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import type { components } from '../../packages/api-client/src/schema'

type Competition = components['schemas']['Competition']
type Meal = components['schemas']['Meal']
type Recap = components['schemas']['Recap']

async function signIn(
  page: Page,
  request: APIRequestContext,
  tag: string,
  name: string,
) {
  const email = `${tag}-${randomUUID()}@example.test`
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
  await page.getByLabel('Display name').fill(name)
  await page.getByRole('button', { name: 'Save display name' }).click()
  await expect(page.getByRole('status')).toHaveText('Display name saved.')
}

async function write<T>(page: Page, path: string, data: unknown, status = 200) {
  const session = (await (
    await page.request.get('/api/v1/auth/session')
  ).json()) as { csrfToken: string }
  const response = await page.request.post(path, {
    headers: { 'X-CSRF-TOKEN': session.csrfToken },
    data,
  })
  expect(response.status()).toBe(status)
  return (await response.json()) as T
}

function shiftWindow(container: string, id: string, close: boolean) {
  expect(id).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)
  execFileSync(
    'docker',
    [
      'exec',
      container,
      'psql',
      '-U',
      'glizzy',
      '-d',
      'glizzy_gauntlet',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `UPDATE competitions SET starts_at = date_trunc('milliseconds', clock_timestamp()) - interval '48 hours',
      ends_at = date_trunc('milliseconds', clock_timestamp()) ${close ? "- interval '24 hours'" : "+ interval '1 hour'"}
      WHERE id = '${id}'`,
    ],
    { stdio: 'pipe' },
  )
}

test('preserves frozen recaps through corrected scores, uncertain retries, exclusion, and restoration', async ({
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
    `recap-owner-${info.project.name}`,
    'Recap captain',
  )
  const competitions: Competition[] = []
  for (const visibility of ['PUBLIC', 'PRIVATE']) {
    let competition = await write<Competition>(
      page,
      '/api/v1/competitions',
      {
        name: `${visibility} recap ${info.project.name} ${Date.now()}`,
        rules: 'Use measured lengths.',
        visibility,
        timeZone: 'UTC',
        allowSharedMeals: true,
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 172800000).toISOString(),
      },
      201,
    )
    competition = await write<Competition>(
      page,
      `/api/v1/competitions/${competition.id}/publish`,
      {
        version: competition.version,
      },
    )
    shiftWindow(container!, competition.id, false)
    competitions.push(competition)
  }
  const [a, b] = competitions
  const session = (await (
    await page.request.get('/api/v1/auth/session')
  ).json()) as { csrfToken: string }
  const photoResponse = await page.request.post('/api/v1/meal-photos', {
    headers: { 'X-CSRF-TOKEN': session.csrfToken },
    multipart: {
      file: {
        name: 'private-meal.png',
        mimeType: 'image/png',
        buffer: await page.screenshot({
          clip: { x: 0, y: 0, width: 16, height: 16 },
        }),
      },
    },
  })
  expect(photoResponse.status()).toBe(201)
  const photo = (await photoResponse.json()) as { id: string }
  const content = {
    eatenAt: new Date(Date.now() - 25 * 3600000).toISOString(),
    venueId: null,
    location: 'Secret picnic',
    notes: 'Private measured source',
    items: [
      {
        name: 'Measured dog',
        wholeQuantity: 2,
        unitHundredths: 800,
        partialHundredths: 300,
      },
    ],
    photoIds: [photo.id],
  }
  const source = await write<Meal>(
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
  const visitorContext = await browser.newContext({
    baseURL: origin,
    viewport: page.viewportSize() ?? undefined,
  })
  try {
    const member = await memberContext.newPage()
    await signIn(
      member,
      request,
      `recap-member-${info.project.name}`,
      'Recap partner',
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
          location: 'Partner picnic',
          photoIds: [],
          items: [
            {
              name: 'Long measured dog',
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
    const visitor = await visitorContext.newPage()
    await visitor.goto(`/competitions/${a.id}/recap`)
    await expect(visitor.getByRole('alert')).toHaveText(
      'The recap becomes available after the 24-hour submission grace period ends.',
    )
    shiftWindow(container!, a.id, true)
    shiftWindow(container!, b.id, true)
    const recapPath = `/api/v1/competitions/${a.id}/recap`
    const originalResponse = await visitor.request.get(recapPath)
    expect(originalResponse.status()).toBe(200)
    expect(originalResponse.headers()['cache-control']).toBe('no-store')
    const original = (await originalResponse.json()) as Recap
    expect(original.result.version).toBe(1)
    expect(original.totalHundredths).toBe(3800)
    expect(original.standings.map((row) => row.rank)).toEqual([1, 1])
    const otherOriginal = (await (
      await page.request.get(`/api/v1/competitions/${b.id}/recap`)
    ).json()) as Recap
    expect(otherOriginal.totalHundredths).toBe(1900)
    await visitor.reload()
    await expect(visitor.getByText('Final recap / Revision 1')).toBeVisible()
    await expect(
      visitor.getByLabel('Recap totals').getByText('38.00'),
    ).toBeVisible()
    await expect(visitor.getByText('Secret picnic')).toHaveCount(0)
    await expect(
      visitor.getByRole('heading', { name: 'Member-only recap highlights' }),
    ).toHaveCount(0)
    expect(
      (await visitor.request.get(`${recapPath}/highlights`)).status(),
    ).toBe(401)
    expect(
      (
        await visitor.request.get(`/api/v1/competitions/${a.id}/corrections`)
      ).status(),
    ).toBe(401)
    expect(
      (
        await visitor.request.get(`/api/v1/competitions/${b.id}/recap`)
      ).status(),
    ).toBe(404)
    expect(
      (await visitor.request.get(`/api/v1/meal-photos/${photo.id}`)).status(),
    ).toBe(401)
    await member.goto(`/competitions/${a.id}/corrections`)
    await expect(
      member.getByText('Only this competition organizer can correct scores.'),
    ).toBeVisible()
    await page.goto(`/competitions/${a.id}/recap`)
    await expect(page.getByText('Secret picnic')).toBeVisible()
    await page.getByRole('link', { name: 'Correct competition scores' }).click()
    const correction = page.getByRole('group', {
      name: 'Recap captain / Secret picnic',
      exact: true,
    })
    await correction.getByLabel('Corrected total inches').fill('17')
    await correction
      .getByLabel('Reason for correction (visible to members)')
      .fill('Measured portion rechecked.')
    let intercepted = 0
    await page.route(
      '**/api/v1/competitions/*/entries/*/corrections',
      async (route) => {
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        intercepted++
        if (intercepted === 1) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'API_UNAVAILABLE' }),
          })
        } else {
          await route.fulfill({ response })
        }
      },
    )
    await correction
      .getByRole('button', { name: 'Publish corrected recap' })
      .click()
    await expect(correction.getByRole('alert')).toContainText(
      'Could not load or save',
    )
    await correction
      .getByRole('button', { name: 'Publish corrected recap' })
      .click()
    await expect(page.getByRole('status')).toHaveText(
      'Published recap revision 2.',
    )
    expect(intercepted).toBe(2)
    await page.unroute('**/api/v1/competitions/*/entries/*/corrections')
    await expect(
      correction.getByLabel('Reason for correction (visible to members)'),
    ).toHaveValue('')
    await expect(
      correction.getByText(/Original measurements: 19.00 inches/),
    ).toBeVisible()
    await expect(correction.getByLabel('Corrected total inches')).toHaveValue(
      '17.00',
    )
    await page.getByRole('link', { name: 'View competition recap' }).click()
    await expect(page.getByText('Revised recap / Revision 2')).toBeVisible()
    await expect(
      page.getByLabel('Recap totals').getByText('36.00'),
    ).toBeVisible()
    await expect(page.getByText('Measured portion rechecked.')).toBeVisible()
    await expect(
      page.getByRole('row', { name: '2 Recap captain 17.00 2' }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'View revision 1', exact: true })
      .click()
    await expect(page.getByText('Final recap / Revision 1')).toBeVisible()
    await expect(
      page.getByLabel('Recap totals').getByText('38.00'),
    ).toBeVisible()
    await expect(
      page.getByText(/These details belong to recap revision 1/),
    ).toBeVisible()
    expect(
      await (await visitor.request.get(`${recapPath}?version=1`)).json(),
    ).toEqual(original)
    expect(
      await (
        await page.request.get(`/api/v1/competitions/${b.id}/recap`)
      ).json(),
    ).toEqual(otherOriginal)
    expect(
      await (await page.request.get(`/api/v1/meals/${source.id}`)).json(),
    ).toMatchObject({
      id: source.id,
      version: source.version,
      archived: source.archived,
      revision: source.revision,
    })
    await member.goto(`/competitions/${a.id}/recap`)
    await expect(member.getByText('Measured portion rechecked.')).toBeVisible()
    await page.getByRole('link', { name: 'Correct competition scores' }).click()
    await correction.getByLabel('Exclude this entry from scoring').check()
    await correction
      .getByLabel('Reason for correction (visible to members)')
      .fill('Not eligible under the written rules.')
    await correction
      .getByRole('button', { name: 'Publish corrected recap' })
      .click()
    await expect(page.getByRole('status')).toHaveText(
      'Published recap revision 3.',
    )
    await expect(
      correction.getByLabel('Reason for correction (visible to members)'),
    ).toHaveValue('')
    const excluded = (await (
      await visitor.request.get(recapPath)
    ).json()) as Recap
    expect(excluded.totalHundredths).toBe(1900)
    expect(
      excluded.standings.find((row) => row.displayName === 'Recap captain')
        ?.totalHundredths,
    ).toBe(0)
    expect(
      (await member.request.get(`/api/v1/meal-photos/${photo.id}`)).status(),
    ).toBe(200)
    await correction.getByLabel('Exclude this entry from scoring').uncheck()
    await correction
      .getByLabel('Reason for correction (visible to members)')
      .fill('Resolved; restore the corrected score.')
    await correction
      .getByRole('button', { name: 'Publish corrected recap' })
      .click()
    await expect(page.getByRole('status')).toHaveText(
      'Published recap revision 4.',
    )
    expect(
      await (await visitor.request.get(`${recapPath}?version=3`)).json(),
    ).toEqual(excluded)
    expect(
      await (await visitor.request.get(`${recapPath}?version=1`)).json(),
    ).toEqual(original)
    const revised = (await (
      await visitor.request.get(recapPath)
    ).json()) as Recap
    expect(revised.totalHundredths).toBe(3600)
    const history = (await (
      await visitor.request.get(`${recapPath}/history`)
    ).json()) as { items: { version: number }[] }
    expect(history.items.map((item) => item.version)).toEqual([4, 3, 2, 1])
    await visitor.reload()
    await expect(visitor.getByText('Revised recap / Revision 4')).toBeVisible()
    await expect(visitor.getByText('Measured portion rechecked.')).toHaveCount(
      0,
    )
    await expect(visitor.getByText('Secret picnic')).toHaveCount(0)
    expect(JSON.stringify(revised)).not.toMatch(
      /Private measured source|Secret picnic|Measured portion rechecked/,
    )
    for (const view of [page, visitor]) {
      expect(
        await view.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
    }
  } finally {
    await memberContext.close()
    await visitorContext.close()
  }
})
