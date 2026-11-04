import { execFileSync } from 'node:child_process'
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

test('separates administered competitions and preserves global administration through opt-out', async ({
  page,
  browser,
  request,
}, info) => {
  const container = process.env.E2E_TEST_DB_CONTAINER
  test.setTimeout(60_000)
  test.skip(!container, 'Requires an explicitly allowed disposable database.')
  expect(
    container !== 'glizzy-gauntlet-db-1' ||
      process.env.GITHUB_ACTIONS === 'true',
    'The canonical database container is allowed only on the disposable GitHub Actions runner.',
  ).toBe(true)
  const allTime = '00000000-0000-4000-8000-000000000000'
  const allTimeName = 'All-time Glizzy Gauntlet'
  const tag = `${info.project.name}-${Date.now()}`
  await signIn(page, request, `admin-${tag}`)
  const session = (await (
    await page.request.get('/api/v1/auth/session')
  ).json()) as {
    user: { id: string; siteOwner: boolean }
  }
  expect(session.user.id).toMatch(/^[a-f0-9-]{36}$/)
  expect(session.user.siteOwner).toBe(false)
  const ownName = `Administered draft ${tag}`
  await draft(page, ownName, 'PRIVATE')
  const guest = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize() ?? undefined,
  })
  const other = await guest.newPage()
  let assigned = false
  const sql = (statement: string) =>
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
        '-Atq',
        '-c',
        statement,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim()
  try {
    await signIn(other, request, `other-admin-${tag}`)
    const otherName = `Other membership ${tag}`
    const otherPath = await draft(other, otherName, 'PUBLIC')
    await other.getByRole('button', { name: 'Publish competition' }).click()
    await expect(
      other.getByRole('button', { name: 'Create invitation' }),
    ).toBeEnabled()
    await page.goto(otherPath)
    await page.getByRole('button', { name: 'Join competition' }).click()
    await expect(
      page.getByRole('heading', { name: 'Members', exact: true }),
    ).toBeVisible()

    sql(
      `INSERT INTO account_roles (user_id, role) VALUES ('${session.user.id}', 'ADMIN')`,
    )
    assigned = true

    await page.goto('/account/competitions')
    const administered = page.getByRole('region', {
      name: 'Competitions I administer',
    })
    const participating = page.getByRole('region', {
      name: 'Other competitions',
    })
    await expect(
      administered.getByRole('link', { name: allTimeName, exact: true }),
    ).toBeVisible()
    await expect(
      administered.getByRole('link', { name: ownName, exact: true }),
    ).toBeVisible()
    await expect(
      participating.getByRole('link', { name: otherName, exact: true }),
    ).toBeVisible()
    await expect(
      participating.getByRole('link', { name: allTimeName, exact: true }),
    ).toHaveCount(0)
    await expect(
      participating.getByRole('link', { name: ownName, exact: true }),
    ).toHaveCount(0)
    await page.reload()
    await expect(
      administered.getByRole('link', { name: allTimeName, exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await administered
      .getByRole('link', { name: allTimeName, exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Create invitation' }),
    ).toBeEnabled()
    await expect(page.getByRole('link', { name: 'Edit settings' })).toHaveCount(
      0,
    )
    await expect(
      page.getByRole('link', { name: 'Competition recap' }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Create invitation' }).click()
    const invitation = page.getByLabel('New invitation link')
    await expect(invitation).toBeVisible()
    await other.goto(await invitation.inputValue())
    await expect(
      other.getByText('All time / No end date', { exact: true }),
    ).toBeVisible()
    await expect(
      other.getByRole('button', { name: 'Accept invitation' }),
    ).toBeEnabled()
    await page
      .getByRole('button', { name: 'Leave all-time competition' })
      .click()
    await expect(
      page.getByRole('button', { name: 'Join competition' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Create invitation' }),
    ).toBeEnabled()
    await page.goto('/account/competitions')
    await expect(
      administered.getByRole('link', { name: allTimeName, exact: true }),
    ).toBeVisible()
    await expect(
      administered.getByText('Rejoin this competition to administer it.'),
    ).toHaveCount(0)
    await administered
      .getByRole('link', { name: allTimeName, exact: true })
      .click()
    const optedOut = await (
      await page.request.get(`/api/v1/competitions/${allTime}`)
    ).json()
    expect(optedOut).toMatchObject({ viewerRole: 'NONE', canAdminister: true })
    await page.getByRole('button', { name: 'Create invitation' }).click()
    await expect(page.getByLabel('New invitation link')).toBeVisible()
    await page.getByRole('button', { name: 'Join competition' }).click()
    await expect(
      page.getByRole('button', { name: 'Leave all-time competition' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Create invitation' }),
    ).toBeEnabled()
    const lifetime = (await (
      await page.request.get(`/api/v1/competitions/${allTime}`)
    ).json()) as {
      viewerRole: string
      trackingMode: string
      visibility: string
      endsAt: string | null
    }
    expect(lifetime).toMatchObject({
      viewerRole: 'ORGANIZER',
      canAdminister: true,
      trackingMode: 'COUNT',
      visibility: 'PUBLIC',
      endsAt: null,
    })
  } finally {
    if (assigned)
      sql(
        `DELETE FROM account_roles WHERE user_id = '${session.user.id}' AND role = 'ADMIN'`,
      )
    await guest.close()
  }
})

async function draft(
  page: Page,
  name: string,
  visibility: 'PUBLIC' | 'PRIVATE',
  trackingMode: 'COUNT' | 'LENGTH' | 'BOTH' = 'BOTH',
  invitationEmails: string[] = [],
) {
  await page.goto('/competitions/new')
  await page.getByLabel('Competition name').fill(name)
  await page
    .getByLabel('Written rules')
    .fill('Use actual measurements. Eat at your own pace.')
  await page.getByLabel('Visibility', { exact: true }).selectOption(visibility)
  await expect(page.getByLabel('What are you tracking?')).toHaveValue('BOTH')
  await page.getByLabel('What are you tracking?').selectOption(trackingMode)
  await page.getByLabel('Competition time zone').fill('UTC')
  await page
    .getByLabel('Eating starts', { exact: true })
    .fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16))
  await page
    .getByLabel('Eating ends', { exact: true })
    .fill(new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 16))
  if (invitationEmails.length)
    await page
      .getByLabel('Invite by email (optional)')
      .fill(invitationEmails.join(';\n'))
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  return new URL(page.url()).pathname
}

test('emails separate private invitations after publication and requires explicit acceptance', async ({
  page,
  browser,
  request,
}, info) => {
  await signIn(page, request, `email-owner-${info.project.name}`)
  const tag = `${info.project.name}-${Date.now()}`
  const recipients = [
    `invite-a-${tag}@example.test`,
    `invite-b-${tag}@example.test`,
  ]
  const inbox = process.env.MAILPIT_BASE_URL ?? 'http://127.0.0.1:8025'
  async function invitationMessages() {
    const response = await request.get(`${inbox}/api/v1/messages`)
    const data = (await response.json()) as {
      messages: { ID: string; To: { Address: string }[] }[]
    }
    return data.messages.filter((message) =>
      message.To.some((to) => recipients.includes(to.Address)),
    )
  }
  const name = `Emailed crew ${tag}`
  const path = await draft(page, name, 'PRIVATE', 'BOTH', [
    recipients[0]!.toUpperCase(),
    recipients[1]!,
    recipients[0]!,
  ])
  const delivery = page.locator('details').filter({
    has: page.locator('summary', { hasText: 'Email invitations' }),
  })
  await expect(
    delivery.getByText(recipients[0]!, { exact: true }),
  ).toBeVisible()
  await expect(
    delivery.getByRole('button', {
      name: 'Send pending or failed invitations',
    }),
  ).toBeDisabled()
  expect(await invitationMessages()).toHaveLength(0)
  await page.getByRole('button', { name: 'Publish competition' }).click()
  await expect.poll(invitationMessages).toHaveLength(2)
  let invitation = ''
  for (const message of await invitationMessages()) {
    expect(message.To).toHaveLength(1)
    const body = (await (
      await request.get(`${inbox}/api/v1/message/${message.ID}`)
    ).json()) as { Text: string }
    expect(body.Text).toContain(name)
    for (const address of recipients) expect(body.Text).not.toContain(address)
    const link = body.Text.match(
      /https?:\/\/\S+\/join\?token=[A-Za-z0-9_-]{43}/,
    )?.[0]
    expect(link).toBeTruthy()
    expect(new URL(link!).origin).toBe(new URL(page.url()).origin)
    invitation = link!
    await expect(
      delivery
        .getByRole('listitem')
        .filter({ hasText: message.To[0]!.Address }),
    ).toContainText(' / Sent')
  }
  await expect(
    page.getByRole('button', { name: 'Revoke invitation', exact: true }),
  ).toHaveCount(2)
  const session = (await (
    await page.request.get('/api/v1/auth/session')
  ).json()) as {
    csrfToken: string
  }
  expect(
    (
      await page.request.post(`/api/v1${path}/invitation-emails`, {
        headers: { 'X-CSRF-TOKEN': session.csrfToken },
      })
    ).status(),
  ).toBe(200)
  expect(await invitationMessages()).toHaveLength(2)
  const guest = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize() ?? undefined,
  })
  try {
    const other = await guest.newPage()
    await other.goto(invitation)
    await expect(
      other.getByRole('heading', { name, exact: true }),
    ).toBeVisible()
    expect((await other.request.get(`/api/v1${path}`)).status()).toBe(404)
    expect(
      (await (await page.request.get(`/api/v1${path}`)).json()).memberCount,
    ).toBe(1)
    await signIn(other, request, `email-member-${info.project.name}`)
    await other.goto(invitation)
    expect(
      (await (await page.request.get(`/api/v1${path}`)).json()).memberCount,
    ).toBe(1)
    await other.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(other.getByText('2 joined', { exact: true })).toBeVisible()
    await expect(
      other.getByText('Email invitations', { exact: true }),
    ).toHaveCount(0)
    expect(
      (await other.request.get(`/api/v1${path}/invitation-emails`)).status(),
    ).toBe(403)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await guest.close()
  }
})

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

test('enrolls a new account in all-time competition and supports persistent leave and rejoin', async ({
  page,
  request,
}, info) => {
  await signIn(page, request, `all-time-${info.project.name}`)
  await expect(
    page.getByRole('link', { name: 'My competitions' }),
  ).toHaveAttribute('href', '/account/competitions')
  const session = (await (
    await page.request.get('/api/v1/auth/session')
  ).json()) as { user: { displayName: string } }
  await page.goto('/competitions')
  const joined = page.getByRole('region', {
    name: 'My competitions',
    exact: true,
  })
  const publicCompetitions = page.getByRole('region', {
    name: 'Public competitions',
    exact: true,
  })
  await expect(
    joined.getByRole('link', { name: 'All-time Glizzy Gauntlet' }),
  ).toBeVisible()
  await expect(
    publicCompetitions.getByRole('link', { name: 'All-time Glizzy Gauntlet' }),
  ).toBeVisible()
  await joined.getByRole('link', { name: 'All-time Glizzy Gauntlet' }).click()
  const path = new URL(page.url()).pathname
  await expect(
    page.getByRole('link', { name: 'Competition recap' }),
  ).toHaveCount(0)
  await page.goto('/meals/new')
  await page.getByLabel('How many hot dogs?').fill('2')
  await page
    .getByRole('checkbox', { name: 'Submit to All-time Glizzy Gauntlet' })
    .check()
  await page
    .getByRole('button', { name: 'Save meal and selected submissions' })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Meal record', exact: true }),
  ).toBeVisible()
  const mealPath = new URL(page.url()).pathname
  await page.goto(path)
  await expect(
    page
      .getByRole('table', { name: 'Live all-time standings' })
      .getByRole('row')
      .filter({ hasText: session.user.displayName }),
  ).toContainText('2')
  await page.getByRole('button', { name: 'Leave all-time competition' }).click()
  await expect(
    page.getByRole('button', { name: 'Join competition', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Join competition', exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('table', { name: 'Live all-time standings' })
      .getByRole('row')
      .filter({ hasText: session.user.displayName }),
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Join competition', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Leave all-time competition' }),
  ).toBeVisible()
  await page.goto(mealPath)
  await expect(
    page.getByText('2 whole hot dogs', { exact: true }).first(),
  ).toBeVisible()
  await expect(page.getByText(/withdrawn/i)).toBeVisible()
})

test('discovers public competitions, joins as a member, and limits settings to the organizer', async ({
  page,
  browser,
  request,
}, info) => {
  await signIn(page, request, `public-owner-${info.project.name}`)
  const name = `Public crew ${info.project.name} ${Date.now()}`
  const path = await draft(page, name, 'PUBLIC', 'COUNT')
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
    await expect(page.getByLabel('What are you tracking?')).toHaveValue('COUNT')
    await page.getByLabel('What are you tracking?').selectOption('LENGTH')
    await page
      .getByLabel('Written rules')
      .fill('Measured lengths only. Take your time.')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page).toHaveURL(new URL(path, page.url()).href)
    expect(
      (await (await page.request.get(`/api/v1${path}`)).json()).trackingMode,
    ).toBe('LENGTH')
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

test('admins grant and revoke venue approval without granting global administration', async ({
  page,
  browser,
  request,
}, info) => {
  const container = process.env.E2E_TEST_DB_CONTAINER
  test.skip(!container, 'Requires an explicitly allowed disposable database.')
  expect(
    container !== 'glizzy-gauntlet-db-1' ||
      process.env.GITHUB_ACTIONS === 'true',
    'The canonical database container is allowed only on the disposable GitHub Actions runner.',
  ).toBe(true)
  const tag = `${info.project.name}-${Date.now()}`
  await signIn(page, request, `roles-admin-${tag}`)
  const adminSession = (await (
    await page.request.get('/api/v1/auth/session')
  ).json()) as {
    user: { id: string }
    csrfToken: string
  }
  expect(adminSession.user.id).toMatch(/^[a-f0-9-]{36}$/)
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
      `INSERT INTO account_roles (user_id, role) VALUES ('${adminSession.user.id}', 'ADMIN')`,
    ],
    { stdio: 'pipe' },
  )
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize() ?? undefined,
  })
  try {
    const other = await context.newPage()
    await signIn(other, request, `role-candidate-${tag}`)
    const otherSession = (await (
      await other.request.get('/api/v1/auth/session')
    ).json()) as {
      user: { id: string }
      csrfToken: string
    }
    const name = `Role candidate ${tag}`
    await other.getByLabel('Display name').fill(name)
    await other.getByRole('button', { name: 'Save display name' }).click()
    await expect(other.getByRole('status')).toHaveText('Display name saved.')
    await page.goto('/account')
    await page.getByRole('link', { name: 'Role management' }).click()
    await page
      .getByLabel('Find account by display name or account ID')
      .fill(otherSession.user.id)
    await page.getByRole('button', { name: 'Find accounts' }).click()
    await page
      .getByRole('button', {
        name: `Grant Venue approver to ${name}`,
        exact: true,
      })
      .click()
    await expect(
      page.getByRole('button', { name: `Revoke Venue approver from ${name}` }),
    ).toBeVisible()
    await other.goto('/account')
    await expect(
      other.getByRole('link', { name: 'Review queue' }),
    ).toBeVisible()
    await expect(
      other.getByRole('link', { name: 'All contributions' }),
    ).toHaveCount(0)
    await expect(
      other.getByRole('link', { name: 'Role management' }),
    ).toHaveCount(0)
    expect((await other.request.get('/api/v1/admin/accounts')).status()).toBe(
      403,
    )
    expect(
      (
        await other.request.put(
          `/api/v1/admin/accounts/${otherSession.user.id}/roles/ADMIN`,
          {
            headers: { 'X-CSRF-TOKEN': otherSession.csrfToken },
          },
        )
      ).status(),
    ).toBe(403)

    const venueName = `Approver stand ${tag}`
    const headers = { 'X-CSRF-TOKEN': adminSession.csrfToken }
    const created = await page.request.post('/api/v1/directory/contributions', {
      headers,
      data: {
        venueId: null,
        baseRevision: null,
        name: venueName,
        address: '100 Example Street',
        description: 'A synthetic test listing.',
        latitude: 40,
        longitude: -74,
        menuItems: [],
      },
    })
    expect(created.status()).toBe(201)
    const contribution = (await created.json()) as { id: string }
    expect(
      (
        await page.request.post(
          `/api/v1/directory/contributions/${contribution.id}/submit`,
          { headers },
        )
      ).ok(),
    ).toBe(true)
    await other.getByRole('link', { name: 'Review queue' }).click()
    await other.getByRole('link', { name: venueName, exact: true }).click()
    await other
      .getByLabel('Review reason')
      .fill('Verified by the assigned venue approver.')
    await other.getByRole('button', { name: 'Approve listing' }).click()
    await expect(
      other.getByRole('link', { name: 'View current public listing' }),
    ).toBeVisible()
    await expect(
      other.getByRole('button', { name: 'Hide listing' }),
    ).toHaveCount(0)
    await page
      .getByRole('button', {
        name: `Revoke Venue approver from ${name}`,
        exact: true,
      })
      .click()
    await expect(
      page.getByRole('button', { name: `Grant Venue approver to ${name}` }),
    ).toBeVisible()
    await other.goto('/account')
    await expect(other.getByRole('link', { name: 'Review queue' })).toHaveCount(
      0,
    )
    expect(
      (
        await other.request.get('/api/v1/directory/contributions?scope=pending')
      ).status(),
    ).toBe(403)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await context.close()
  }
})
