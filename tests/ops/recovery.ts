import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type APIRequestContext } from '@playwright/test'
import { backup, restore } from '../../ops/operations.ts'
import type { components } from '../../packages/api-client/src/schema.d.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
type Competition = components['schemas']['Competition']
type Meal = components['schemas']['Meal']
type Session = components['schemas']['SessionInfo']
type Recap = components['schemas']['Recap']
const source = process.env.RECOVERY_SOURCE_PROJECT ?? ''
const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
const inbox = process.env.MAILPIT_BASE_URL ?? 'http://127.0.0.1:8025'
assert.equal(
  process.env.RECOVERY_TEST_DISPOSABLE,
  '1',
  'Explicitly allow this test only on a disposable local stack.',
)
assert.match(source, /^[a-z0-9][a-z0-9_-]{0,25}$/)
for (const url of [origin, inbox])
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
const target = `${source}-restore-${randomUUID().slice(0, 8)}`
const targetPort = process.env.RECOVERY_TARGET_PORT ?? '3113'
assert.match(targetPort, /^\d{4,5}$/)
const targetOrigin = `http://127.0.0.1:${targetPort}`
const environment = {
  ...process.env,
  POSTGRES_PASSWORD: 'recovery-test-only-password',
  GATEWAY_PORT: targetPort,
  POSTGRES_PORT: '0',
  MAILPIT_PORT: '0',
  GOOGLE_ENABLED: 'false',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  SMTP_USERNAME: '',
  SMTP_PASSWORD: '',
}
function command(args: string[]) {
  return execFileSync('docker', args, {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 240000,
    maxBuffer: 8 * 1024 * 1024,
  }).trim()
}
function compose(...args: string[]) {
  return command([
    'compose',
    '-p',
    target,
    '--env-file',
    '.env.example',
    '-f',
    'infra/compose.yaml',
    '-f',
    'infra/compose.dev.yaml',
    ...args,
  ])
}
const sourceDb = command([
  'ps',
  '-q',
  '--filter',
  `label=com.docker.compose.project=${source}`,
  '--filter',
  'label=com.docker.compose.service=db',
])
assert.match(sourceDb, /^[a-f0-9]{12,64}$/)
function sql(db: string, query: string) {
  return command([
    'exec',
    db,
    'psql',
    '-X',
    '-U',
    'glizzy',
    '-d',
    'glizzy_gauntlet',
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
    '-c',
    query,
  ])
}
function shift(id: string, close: boolean) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)
  sql(
    sourceDb,
    `UPDATE competitions SET starts_at = clock_timestamp() - interval '48 hours',
    ends_at = clock_timestamp() ${close ? "- interval '24 hours'" : "+ interval '1 hour'"} WHERE id = '${id}'`,
  )
}
async function get<T>(
  request: APIRequestContext,
  base: string,
  path: string,
): Promise<T> {
  const response = await request.get(base + path)
  assert.equal(response.status(), 200)
  return (await response.json()) as T
}
async function write<T>(
  request: APIRequestContext,
  base: string,
  path: string,
  body: unknown,
  status = 200,
): Promise<T> {
  const session = await get<Session>(request, base, '/api/v1/auth/session')
  const response = await request.post(base + path, {
    data: body,
    headers: { 'X-CSRF-TOKEN': session.csrfToken },
  })
  assert.equal(response.status(), status)
  return (await response.json()) as T
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

const temporary = await mkdtemp(join(tmpdir(), 'glizzy-recovery-'))
const browser = await chromium.launch()
let createdTarget = false
try {
  assert.equal(
    command([
      'ps',
      '-aq',
      '--filter',
      `label=com.docker.compose.project=${target}`,
    ]),
    '',
  )
  assert.equal(
    command([
      'volume',
      'ls',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${target}`,
    ]),
    '',
  )
  const context = await browser.newContext({ baseURL: origin })
  await context.setExtraHTTPHeaders({
    Forwarded: 'host=untrusted.invalid;proto=https',
    'X-Forwarded-Host': 'untrusted.invalid',
    'X-Forwarded-Proto': 'https',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const email = `recovery-${randomUUID()}@example.test`
  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await page
    .getByRole('status')
    .filter({ hasText: 'If delivery is available' })
    .waitFor()
  let messageId = ''
  for (let attempt = 0; attempt < 40 && !messageId; attempt++) {
    const listing = (await (
      await fetch(`${inbox}/api/v1/messages`)
    ).json()) as {
      messages: { ID: string; To: { Address: string }[] }[]
    }
    messageId =
      listing.messages.find((message) =>
        message.To.some((to) => to.Address === email),
      )?.ID ?? ''
    if (!messageId) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.ok(messageId)
  const message = (await (
    await fetch(`${inbox}/api/v1/message/${messageId}`)
  ).json()) as { Text: string }
  const link = message.Text.match(
    /https?:\/\/\S+\/sign-in\/confirm\?token=[A-Za-z0-9_-]{43}/,
  )?.[0]
  assert.ok(link)
  assert.equal(
    new URL(link).origin,
    new URL(origin).origin,
    'Spoofed proxy headers must not change sign-in destinations.',
  )
  await page.goto(link)
  await page.getByRole('button', { name: 'Confirm sign-in' }).click()
  await page.getByLabel('Display name').fill('Recovery captain')
  await page.getByRole('button', { name: 'Save display name' }).click()
  await page
    .getByRole('status')
    .filter({ hasText: 'Display name saved.' })
    .waitFor()
  await context.setExtraHTTPHeaders({})
  const session = await get<Session>(
    context.request,
    origin,
    '/api/v1/auth/session',
  )
  const competitions: Competition[] = []
  for (const visibility of ['PUBLIC', 'PRIVATE']) {
    let competition = await write<Competition>(
      context.request,
      origin,
      '/api/v1/competitions',
      {
        name: `${visibility} recovery ${randomUUID()}`,
        visibility,
        timeZone: 'UTC',
        rules: 'Use measured lengths.',
        allowSharedMeals: true,
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 172800000).toISOString(),
      },
      201,
    )
    competition = await write<Competition>(
      context.request,
      origin,
      `/api/v1/competitions/${competition.id}/publish`,
      {
        version: competition.version,
      },
    )
    shift(competition.id, false)
    competitions.push(competition)
  }
  const upload = await context.request.post(origin + '/api/v1/meal-photos', {
    headers: { 'X-CSRF-TOKEN': session.csrfToken },
    multipart: {
      file: {
        name: 'recovery.png',
        mimeType: 'image/png',
        buffer: await page.screenshot({
          clip: { x: 0, y: 0, width: 16, height: 16 },
        }),
      },
    },
  })
  assert.equal(upload.status(), 201)
  const photo = (await upload.json()) as { id: string }
  const create = {
    requestId: randomUUID(),
    version: 0,
    content: {
      eatenAt: new Date(Date.now() - 25 * 3600000).toISOString(),
      venueId: null,
      location: 'Private recovery picnic',
      notes: 'Original measurements.',
      items: [
        {
          name: 'Measured dog',
          wholeQuantity: 2,
          unitHundredths: 800,
          partialHundredths: 300,
        },
      ],
      photoIds: [photo.id],
    },
    competitionIds: competitions.map((item) => item.id),
  }
  const meal = await write<Meal>(
    context.request,
    origin,
    '/api/v1/meals',
    create,
    201,
  )
  for (const item of competitions) shift(item.id, true)
  const [a, b] = competitions
  const recapPath = `/api/v1/competitions/${a.id}/recap`
  const original = await get<Recap>(context.request, origin, recapPath)
  const privateRecap = await get<Recap>(
    context.request,
    origin,
    `/api/v1/competitions/${b.id}/recap`,
  )
  const entries = await get<{ items: { id: string; version: number }[] }>(
    context.request,
    origin,
    `/api/v1/competitions/${a.id}/meals`,
  )
  const correctionPath = `/api/v1/competitions/${a.id}/entries/${entries.items[0].id}/corrections`
  const correction = {
    requestId: randomUUID(),
    version: entries.items[0].version,
    totalHundredths: 1700,
    wholeHotDogs: 2,
    excluded: false,
    reason: 'Corrected retained score.',
  }
  const receipt = await write(
    context.request,
    origin,
    correctionPath,
    correction,
  )
  const originalPhoto = await context.request.get(
    origin + `/api/v1/meal-photos/${photo.id}`,
  )
  assert.equal(originalPhoto.status(), 200)
  assert.match(originalPhoto.headers()['content-type'], /^image\/jpeg/)
  const before = {
    meal: await get<Meal>(context.request, origin, `/api/v1/meals/${meal.id}`),
    recap: await get<Recap>(context.request, origin, recapPath),
    history: await get(context.request, origin, recapPath + '/history'),
    audit: await get(
      context.request,
      origin,
      `/api/v1/competitions/${a.id}/corrections`,
    ),
    venues: await get(context.request, origin, '/api/v1/venues'),
    photo: hash(await originalPhoto.body()),
  }
  assert.equal(before.recap.totalHundredths, 1700)
  const snapshot = join(temporary, 'snapshot')
  await backup({ project: source, output: snapshot })
  assert.equal(
    (await get<Session>(context.request, origin, '/api/v1/auth/session')).user
      ?.id,
    session.user?.id,
  )
  assert.equal(
    (await context.request.get(origin + '/api/v1/status')).status(),
    200,
  )

  createdTarget = true
  compose('build', '--quiet', 'api', 'gateway')
  compose('create', 'api', 'gateway')
  compose('up', '-d', '--wait', 'db')
  const targetDb = command([
    'ps',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${target}`,
    '--filter',
    'label=com.docker.compose.service=db',
  ])
  assert.match(targetDb, /^[a-f0-9]{12,64}$/)
  const corrupt = join(temporary, 'corrupt')
  await mkdir(corrupt, { mode: 0o700 })
  for (const file of ['manifest.json', 'database.dump', 'media.tar']) {
    await copyFile(join(snapshot, file), join(corrupt, file))
    await chmod(join(corrupt, file), 0o600)
  }
  await appendFile(join(corrupt, 'database.dump'), 'corruption fixture')
  await assert.rejects(
    restore({ project: target, input: corrupt }),
    /checksum mismatch/,
  )
  assert.equal(
    sql(targetDb, "SELECT to_regclass('public.app_users') IS NULL"),
    't',
  )
  await restore({ project: target, input: snapshot })
  await assert.rejects(
    restore({ project: target, input: snapshot }),
    /nonempty target database/,
  )
  compose('up', '-d', '--wait')
  const afterSession = await get<Session>(
    context.request,
    targetOrigin,
    '/api/v1/auth/session',
  )
  assert.deepEqual(afterSession.user, session.user)
  assert.deepEqual(
    await get(context.request, targetOrigin, `/api/v1/meals/${meal.id}`),
    before.meal,
  )
  assert.deepEqual(
    await get(context.request, targetOrigin, recapPath),
    before.recap,
  )
  assert.deepEqual(
    await get(context.request, targetOrigin, recapPath + '?version=1'),
    original,
  )
  assert.deepEqual(
    await get(context.request, targetOrigin, recapPath + '/history'),
    before.history,
  )
  assert.deepEqual(
    await get(
      context.request,
      targetOrigin,
      `/api/v1/competitions/${a.id}/corrections`,
    ),
    before.audit,
  )
  assert.deepEqual(
    await get(
      context.request,
      targetOrigin,
      `/api/v1/competitions/${b.id}/recap`,
    ),
    privateRecap,
  )
  assert.deepEqual(
    await get(context.request, targetOrigin, '/api/v1/venues'),
    before.venues,
  )
  const restoredPhoto = await context.request.get(
    targetOrigin + `/api/v1/meal-photos/${photo.id}`,
  )
  assert.equal(restoredPhoto.status(), 200)
  assert.equal(hash(await restoredPhoto.body()), before.photo)
  const replay = await context.request.post(targetOrigin + correctionPath, {
    headers: { 'X-CSRF-TOKEN': session.csrfToken },
    data: correction,
  })
  assert.equal(replay.status(), 200)
  assert.deepEqual(await replay.json(), receipt)
  assert.equal(
    (
      await write<Meal>(
        context.request,
        targetOrigin,
        '/api/v1/meals',
        create,
        201,
      )
    ).version,
    meal.version,
  )
  const anonymous = await browser.newContext()
  assert.equal(
    (
      await anonymous.request.get(
        targetOrigin + `/api/v1/meal-photos/${photo.id}`,
      )
    ).status(),
    401,
  )
  assert.equal(
    (
      await anonymous.request.get(targetOrigin + `/api/v1/meals/${meal.id}`)
    ).status(),
    401,
  )
  assert.equal(
    (
      await anonymous.request.get(
        targetOrigin + `/api/v1/competitions/${b.id}/recap`,
      )
    ).status(),
    404,
  )
  const publicRecap = await get<Recap>(
    anonymous.request,
    targetOrigin,
    recapPath,
  )
  assert.deepEqual(publicRecap, before.recap)
  assert.ok(!JSON.stringify(publicRecap).includes('Private recovery picnic'))
  await page.goto(targetOrigin + `/competitions/${a.id}/recap`)
  await page.getByText('Revised recap / Revision 2').waitFor()
  const document = await anonymous.request.get(targetOrigin)
  assert.equal(document.headers()['referrer-policy'], 'no-referrer')
  assert.equal(document.headers()['x-frame-options'], 'DENY')
  console.log(
    'PASS: writers resumed after a consistent database-plus-media backup.',
  )
  console.log(
    'PASS: corrupt and populated targets rejected; restored into new empty PostgreSQL/media volumes.',
  )
  console.log(
    'PASS: account/session/CSRF, sources, exact private photo bytes, public directory, old/revised recaps, audit, and durable request replay recovered.',
  )
  console.log(
    'PASS: restored private data remains inaccessible anonymously; spoofed proxy headers cannot change sign-in destinations.',
  )
} finally {
  await browser.close()
  if (createdTarget) {
    compose('down', '--volumes')
    for (const service of ['api', 'gateway']) {
      const image = `${target}-${service}:latest`
      try {
        command(['image', 'inspect', image])
      } catch {
        continue
      }
      command(['image', 'rm', image])
    }
  }
  await rm(temporary, { recursive: true })
}
