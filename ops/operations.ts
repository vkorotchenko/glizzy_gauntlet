import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { arch, platform, tmpdir, totalmem } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
const projectPattern = /^[a-z0-9][a-z0-9_-]{0,47}$/
const imagePattern = /^sha256:[a-f0-9]{64}$/
const files = ['database.dump', 'media.tar'] as const
type FileName = (typeof files)[number]
type IO = { input?: number; output?: number }
export type Runner = (args: string[], io?: IO) => Promise<string>
type Container = {
  id: string
  service: string
  image: string
  running: boolean
  paused: boolean
  restarting: boolean
  mounts: { Type: string; Name: string; Destination: string; Source?: string }[]
}
type Stack = {
  db: Container
  api: Container
  gateway: Container
  media: string
}
type Digest = { sha256: string; bytes: number }
type Manifest = {
  format: 1
  project: string
  createdAt: string
  postgresMajor: 17
  apiImage: string
  databaseImage: string
  files: Record<FileName, Digest>
}

export const docker: Runner = (args, io = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      stdio: [io.input ?? 'ignore', io.output ?? 'pipe', 'pipe'],
    })
    let output = ''
    let size = 0
    child.stdout?.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 8 * 1024 * 1024) {
        child.kill()
        reject(new Error('Docker output exceeded the inspection limit.'))
      } else output += chunk.toString()
    })
    child.stderr?.resume()
    child.on('error', () => reject(new Error('Could not run Docker.')))
    child.on('close', (code) => {
      if (code === 0) resolve(output.trim())
      else
        reject(
          new Error(
            `Docker ${args[0]} failed (exit ${code ?? 'signal'}); configuration values were not logged.`,
          ),
        )
    })
  })

function projectName(project: string) {
  if (!projectPattern.test(project))
    throw new Error(
      'Use an explicit Compose project name of 1-48 lowercase letters, digits, underscores, or hyphens.',
    )
  return project
}

async function readStack(project: string, run: Runner): Promise<Stack> {
  projectName(project)
  const ids = await run([
    'ps',
    '-aq',
    '--filter',
    `label=com.docker.compose.project=${project}`,
  ])
  const containers = await Promise.all(
    ids
      .split(/\s+/)
      .filter(Boolean)
      .map(async (id) => {
        if (!/^[a-f0-9]{12,64}$/.test(id))
          throw new Error('Unexpected container identifier.')
        const description = await run([
          'inspect',
          '--format',
          '{"service":{{json (index .Config.Labels "com.docker.compose.service")}},"image":{{json .Image}},"running":{{.State.Running}},"paused":{{.State.Paused}},"restarting":{{.State.Restarting}},"mounts":{{json .Mounts}}}',
          id,
        ])
        return { ...JSON.parse(description), id } as Container
      }),
  )
  if (
    containers.some(
      (item) =>
        !['db', 'api', 'gateway', 'caddy', 'mailpit'].includes(item.service),
    )
  )
    throw new Error(
      'Unknown project service; review all writers before maintenance.',
    )
  const find = (service: string) => {
    const matches = containers.filter((item) => item.service === service)
    if (
      matches.length !== 1 ||
      matches[0].paused ||
      matches[0].restarting ||
      !imagePattern.test(matches[0].image)
    )
      throw new Error(
        `Require exactly one stable ${service} container in the named project.`,
      )
    return matches[0]
  }
  const db = find('db'),
    api = find('api'),
    gateway = find('gateway')
  if (!db.running)
    throw new Error('The project database must already be running.')
  for (const [container, destination, logical] of [
    [db, '/var/lib/postgresql/data', 'database'],
    [api, '/app/media', 'media'],
  ] as const) {
    const mount = container.mounts.find(
      (item) => item.Destination === destination,
    )
    if (
      mount?.Type !== 'volume' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(mount.Name)
    )
      throw new Error(`Require a project-owned named ${logical} volume.`)
    const labels = JSON.parse(
      await run([
        'volume',
        'inspect',
        '--format',
        '{{json .Labels}}',
        mount.Name,
      ]),
    )
    if (
      labels?.['com.docker.compose.project'] !== project ||
      labels?.['com.docker.compose.volume'] !== logical
    )
      throw new Error(`The ${logical} volume does not belong to this project.`)
  }
  const version = await query(run, db.id, 'SHOW server_version_num')
  if (Math.floor(Number(version) / 10000) !== 17)
    throw new Error('These tools require PostgreSQL 17.')
  return {
    db,
    api,
    gateway,
    media: api.mounts.find((item) => item.Destination === '/app/media')!.Name,
  }
}

function query(run: Runner, db: string, sql: string) {
  return run([
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
    sql,
  ])
}

async function locked<T>(
  project: string,
  run: Runner,
  task: (stack: Stack) => Promise<T>,
) {
  const initial = await readStack(project, run)
  // A daemon-wide name prevents concurrent operators from resuming each other's writers.
  const lock = await run([
    'create',
    '--name',
    `glizzy-ops-lock-${project}`,
    '--label',
    `com.glizzygauntlet.maintenance=${project}`,
    '--network',
    'none',
    '--read-only',
    '--mount',
    'type=tmpfs,target=/var/lib/postgresql/data',
    '--entrypoint',
    '/bin/true',
    initial.db.image,
  ])
  if (!/^[a-f0-9]{12,64}$/.test(lock))
    throw new Error('Could not acquire the maintenance container lock.')
  try {
    return await task(await readStack(project, run))
  } finally {
    await run(['rm', '--volumes', lock])
  }
}

async function healthy(id: string, run: Runner) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const state = await run([
      'inspect',
      '--format',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
      id,
    ])
    if (state === 'healthy') return
    if (!['starting', 'running'].includes(state))
      throw new Error(
        'A restarted service is not healthy; keep the deployment offline and inspect it locally.',
      )
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(
    'Timed out waiting for a restarted service; inspect it locally.',
  )
}

async function maintenance<T>(
  stack: Stack,
  run: Runner,
  task: () => Promise<T>,
) {
  let failure: unknown
  let result: T | undefined
  try {
    for (const item of [stack.gateway, stack.api])
      if (item.running) await run(['stop', '--time', '30', item.id])
    result = await task()
  } catch (error) {
    failure = error
  }
  const restartErrors: unknown[] = []
  for (const item of [stack.api, stack.gateway]) {
    if (!item.running) continue
    try {
      await run(['start', item.id])
      await healthy(item.id, run)
    } catch (error) {
      restartErrors.push(error)
    }
  }
  if (failure || restartErrors.length)
    throw new AggregateError(
      [failure, ...restartErrors].filter(Boolean),
      'Maintenance failed; original running services were restarted where possible. Inspect their health before continuing.',
    )
  return result as T
}

async function outsideCheckout(path: string) {
  const location = resolve(path)
  const parent = await realpath(dirname(location))
  const result = join(parent, basename(location))
  const rel = relative(await realpath(root), result)
  if (
    !rel ||
    (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      !isAbsolute(rel))
  )
    throw new Error('Keep private backups outside the repository.')
  if (/[,\r\n]/.test(result))
    throw new Error('Backup paths cannot contain commas or newlines.')
  return result
}

async function digest(path: string): Promise<Digest> {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    hash.update(chunk)
  }
  return { sha256: hash.digest('hex'), bytes }
}

function contains(directory: string, path: string) {
  const rel = relative(directory, path)
  return !rel || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
}

function mediaCommand(
  stack: Stack,
  entrypoint: string,
  args: string[],
  readOnly: boolean,
  archive?: string,
) {
  return [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--mount',
    `type=volume,source=${stack.media},target=/media,volume-nocopy${readOnly ? ',readonly' : ''}`,
    ...(archive
      ? ['--mount', `type=bind,source=${archive},target=/backup.tar,readonly`]
      : []),
    '--entrypoint',
    entrypoint,
    stack.db.image,
    ...args,
  ]
}

async function inspectMedia(stack: Stack, archive: string, run: Runner) {
  const temporary = await mkdtemp(join(tmpdir(), 'glizzy-media-inspect-'))
  const paths = ['names', 'details'].map((name) => join(temporary, name))
  const streams: ReturnType<typeof createReadStream>[] = []
  const readers: ReturnType<typeof createInterface>[] = []
  try {
    for (const [index, option] of ['-tf', '-tvf'].entries()) {
      const handle = await open(paths[index], 'wx', 0o600)
      try {
        await run(
          mediaCommand(stack, 'tar', [option, '/backup.tar'], true, archive),
          { output: handle.fd },
        )
      } finally {
        await handle.close()
      }
    }
    for (const path of paths) {
      const stream = createReadStream(path)
      streams.push(stream)
      readers.push(createInterface({ input: stream, crlfDelay: Infinity }))
    }
    const details = readers[1][Symbol.asyncIterator]()
    const seen = new Set<string>()
    for await (const name of readers[0]) {
      const row = await details.next()
      if (row.done || seen.has(name))
        throw new Error('Invalid or duplicate media archive entries.')
      validateMediaArchive(name, row.value)
      seen.add(name)
    }
    if (!seen.size || !(await details.next()).done)
      throw new Error('Invalid media archive listing.')
  } finally {
    for (const reader of readers) reader.close()
    for (const stream of streams) stream.destroy()
    await rm(temporary, { recursive: true })
  }
}

export async function backup(
  options: { project: string; output: string },
  run: Runner = docker,
) {
  const output = await outsideCheckout(options.output)
  return locked(options.project, run, async (stack) => {
    for (const mount of [...stack.api.mounts, ...stack.db.mounts])
      if (mount.Source && contains(mount.Source, output))
        throw new Error('Keep backups outside the database and media volumes.')
    await mkdir(output, { mode: 0o700 })
    return maintenance(stack, run, async () => {
      for (const name of files) {
        const handle = await open(join(output, name), 'wx', 0o600)
        try {
          await run(
            name === 'database.dump'
              ? [
                  'exec',
                  stack.db.id,
                  'pg_dump',
                  '-U',
                  'glizzy',
                  '-d',
                  'glizzy_gauntlet',
                  '--format=custom',
                  '--no-owner',
                  '--no-acl',
                ]
              : mediaCommand(
                  stack,
                  'tar',
                  ['-cf', '-', '-C', '/media', '.'],
                  true,
                ),
            { output: handle.fd },
          )
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
      await inspectMedia(stack, join(output, 'media.tar'), run)
      const manifest: Manifest = {
        format: 1,
        project: options.project,
        createdAt: new Date().toISOString(),
        postgresMajor: 17,
        apiImage: stack.api.image,
        databaseImage: stack.db.image,
        files: {
          'database.dump': await digest(join(output, 'database.dump')),
          'media.tar': await digest(join(output, 'media.tar')),
        },
      }
      await writeFile(
        join(output, 'manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
        { flag: 'wx', mode: 0o600, flush: true },
      )
      return manifest
    })
  })
}

export async function validateBackup(
  input: string,
): Promise<{ directory: string; manifest: Manifest }> {
  const directory = await outsideCheckout(await realpath(input))
  const metadata = await lstat(join(directory, 'manifest.json'))
  if (!metadata.isFile() || metadata.size > 65536 || metadata.mode & 0o077)
    throw new Error(
      'Require an owner-only regular manifest file, at most 64 KiB.',
    )
  const manifest = JSON.parse(
    await readFile(join(directory, 'manifest.json'), 'utf8'),
  ) as Manifest
  if (
    manifest.format !== 1 ||
    manifest.postgresMajor !== 17 ||
    !projectPattern.test(manifest.project) ||
    !imagePattern.test(manifest.apiImage) ||
    !imagePattern.test(manifest.databaseImage) ||
    !manifest.files ||
    Object.keys(manifest.files).sort().join(',') !== [...files].sort().join(',')
  )
    throw new Error('Unsupported or invalid backup manifest.')
  for (const name of files) {
    const path = join(directory, name)
    const stat = await lstat(path)
    const expected = manifest.files[name]
    if (
      !stat.isFile() ||
      stat.mode & 0o077 ||
      !expected ||
      !Number.isSafeInteger(expected.bytes) ||
      expected.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(expected.sha256)
    )
      throw new Error(
        'Require owner-only regular backup files and valid digests.',
      )
    const actual = await digest(path)
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      throw new Error('Backup checksum mismatch; the target was not modified.')
  }
  return { directory, manifest }
}

export function validateMediaArchive(names: string, details: string) {
  const entries = names.split('\n').filter(Boolean)
  const rows = details.split('\n').filter(Boolean)
  const safe =
    /^\.\/(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?:-thumb)?\.jpg)?$/
  if (
    !entries.length ||
    new Set(entries).size !== entries.length ||
    entries.length !== rows.length ||
    entries.some((name) => !safe.test(name)) ||
    rows.some((row, index) => row[0] !== (entries[index] === './' ? 'd' : '-'))
  )
    throw new Error(
      'Media archive must contain only the root directory and regular UUID-named JPEGs; links and traversal are forbidden.',
    )
}

export async function restore(
  options: { project: string; input: string },
  run: Runner = docker,
) {
  const { directory, manifest } = await validateBackup(options.input)
  if (projectName(options.project) === manifest.project)
    throw new Error(
      'Restore into a different, empty Compose project, never the source project.',
    )
  return locked(options.project, run, async (stack) => {
    if (stack.api.running || stack.gateway.running)
      throw new Error(
        'Restore requires API and gateway containers to remain stopped.',
      )
    const empty = await query(
      run,
      stack.db.id,
      `SELECT NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      UNION ALL SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public', 'information_schema'))`,
    )
    if (empty !== 't')
      throw new Error('Restore refuses a nonempty target database.')
    const contents = await run(
      mediaCommand(
        stack,
        'find',
        ['/media', '-mindepth', '1', '-maxdepth', '1', '-print', '-quit'],
        true,
      ),
    )
    if (contents)
      throw new Error('Restore refuses a nonempty target media volume.')
    const archive = join(directory, 'media.tar')
    await inspectMedia(stack, archive, run)
    await run(
      mediaCommand(
        stack,
        'tar',
        ['-xpf', '/backup.tar', '-C', '/media'],
        false,
        archive,
      ),
    )
    const handle = await open(join(directory, 'database.dump'), 'r')
    try {
      await run(
        [
          'exec',
          '-i',
          stack.db.id,
          'pg_restore',
          '-U',
          'glizzy',
          '-d',
          'glizzy_gauntlet',
          '--single-transaction',
          '--exit-on-error',
          '--no-owner',
          '--no-acl',
        ],
        { input: handle.fd },
      )
    } finally {
      await handle.close()
    }
    return {
      restored: true,
      sourceProject: manifest.project,
      targetProject: options.project,
      instruction:
        'Target API and gateway remain stopped. Use the backed-up application revision, then start and verify privately before switching traffic.',
    }
  })
}

type ComposeConfig = {
  services?: Record<
    string,
    {
      environment?: Record<string, string | boolean>
      ports?: { target?: number; published?: string }[]
      profiles?: string[]
    }
  >
}
export function deploymentProblems(
  config: ComposeConfig,
  host: { platform: string; arch: string },
) {
  const problems: string[] = []
  const services = config.services ?? {}
  const env = services.api?.environment ?? {}
  const value = (key: string) => String(env[key] ?? '')
  const enabled = (key: string) => value(key) === 'true'
  const configured = (text: string) =>
    text.trim().length > 0 &&
    !/replace|placeholder|example|test.only/i.test(text)
  if (host.platform !== 'linux' || !['x64', 'arm64'].includes(host.arch))
    problems.push(
      'HOST: run on the intended 64-bit Linux production host; Docker Desktop is only a rehearsal.',
    )
  const hostname = String(services.caddy?.environment?.PUBLIC_HOSTNAME ?? '')
  if (
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
      hostname,
    ) ||
    /(?:^|\.)(?:localhost|local|test|invalid|example)$/i.test(hostname)
  )
    problems.push(
      'PUBLIC_HOSTNAME: configure the real DNS hostname, not a local or example name.',
    )
  if (value('PUBLIC_BASE_URL') !== `https://${hostname}`)
    problems.push(
      'PUBLIC_BASE_URL: require the exact HTTPS origin matching PUBLIC_HOSTNAME.',
    )
  if (value('COOKIE_SECURE') && !enabled('COOKIE_SECURE'))
    problems.push('COOKIE_SECURE: production sessions require Secure cookies.')
  const password = String(services.db?.environment?.POSTGRES_PASSWORD ?? '')
  if (password.length < 24 || !configured(password))
    problems.push(
      'POSTGRES_PASSWORD: use an independently generated password of at least 24 characters.',
    )
  for (const [name, service] of Object.entries(services))
    if (name !== 'caddy' && service.ports?.length)
      problems.push(
        `PORTS: ${name} must not publish host ports in the production configuration.`,
      )
  const ports = services.caddy?.ports ?? []
  if (
    ports.length !== 2 ||
    ![80, 443].every((port) =>
      ports.some(
        (item) =>
          item.target === port && String(item.published) === String(port),
      ),
    )
  )
    problems.push('CADDY: publish only HTTP 80 and HTTPS 443.')
  if (!enabled('EMAIL_ENABLED') && !enabled('GOOGLE_ENABLED'))
    problems.push('SIGN_IN: configure at least one real sign-in provider.')
  if (
    enabled('GOOGLE_ENABLED') &&
    (!value('GOOGLE_CLIENT_ID').endsWith('.apps.googleusercontent.com') ||
      !configured(value('GOOGLE_CLIENT_SECRET')))
  )
    problems.push(
      'GOOGLE: configure the registered web client and secret; verify the exact callback separately.',
    )
  if (enabled('EMAIL_ENABLED')) {
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('MAIL_FROM')) ||
      !configured(value('SMTP_HOST')) ||
      ['localhost', '127.0.0.1', '::1', 'mailpit'].includes(value('SMTP_HOST'))
    )
      problems.push('SMTP: configure a real sender and non-loopback provider.')
    if (
      !enabled('SMTP_AUTH') ||
      !enabled('SMTP_STARTTLS') ||
      !configured(value('SMTP_USERNAME')) ||
      !configured(value('SMTP_PASSWORD'))
    )
      problems.push(
        'SMTP: require authenticated STARTTLS and runtime credentials for public email delivery.',
      )
    const port = Number(value('SMTP_PORT'))
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 465)
      problems.push(
        'SMTP_PORT: use the provider STARTTLS port; implicit-TLS port 465 is not configured.',
      )
  }
  return problems
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      project: { type: 'string' },
      output: { type: 'string' },
      input: { type: 'string' },
      'env-file': { type: 'string', default: '.env' },
      development: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log(
      'Usage: npm run ops -- backup --project NAME --output /private/new-backup\n       npm run ops -- restore --project EMPTY_TARGET --input /private/backup\n       npm run ops -- preflight --env-file .env [--development]\nBackup briefly stops writers; restore never overwrites populated volumes or starts the app.',
    )
    return
  }
  if (positionals.length !== 1)
    throw new Error('Choose backup, restore, or preflight; use --help.')
  const [command] = positionals
  if (command === 'backup' && values.project && values.output) {
    const manifest = await backup({
      project: values.project,
      output: values.output,
    })
    console.log(
      JSON.stringify(
        {
          complete: true,
          project: manifest.project,
          createdAt: manifest.createdAt,
          warning:
            'Private plaintext data: keep owner-only, encrypted at rest, and independently stored. Copy all three files together.',
        },
        null,
        2,
      ),
    )
  } else if (command === 'restore' && values.project && values.input) {
    console.log(
      JSON.stringify(
        await restore({ project: values.project, input: values.input }),
        null,
        2,
      ),
    )
  } else if (command === 'preflight') {
    const args = [
      'compose',
      '--env-file',
      resolve(root, values['env-file']!),
      '-f',
      join(root, 'infra/compose.yaml'),
    ]
    if (values.development)
      args.push('-f', join(root, 'infra/compose.dev.yaml'))
    args.push('--profile', 'public', 'config', '--format', 'json')
    const config = JSON.parse(await docker(args)) as ComposeConfig
    const engine = JSON.parse(
      await docker([
        'info',
        '--format',
        '{"os":{{json .OSType}},"arch":{{json .Architecture}},"memoryBytes":{{.MemTotal}}}',
      ]),
    )
    const host = {
      platform: platform(),
      arch: arch(),
      memoryBytes: totalmem(),
      docker: engine,
    }
    const problems = deploymentProblems(config, host)
    if (engine.os !== 'linux')
      problems.push('DOCKER: require the Linux container engine.')
    console.log(
      JSON.stringify(
        {
          host,
          configurationPassed: !problems.length,
          problems,
          manualGates: [
            'Measure representative concurrent use, uploads, finalization, and backup resource demand on the chosen host.',
            'Verify DDNS, router/firewall exposure, and publicly trusted HTTPS from outside the home network.',
            'Verify real Google sign-in and SMTP inbox delivery; preflight does not contact providers.',
            'Keep independent encrypted backups and rehearse a clean restore before public launch.',
          ],
        },
        null,
        2,
      ),
    )
    if (problems.length) process.exitCode = 1
  } else throw new Error('Missing or invalid command arguments; use --help.')
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (error instanceof Error && !(error instanceof SyntaxError))
      console.error(error.message)
    console.error(
      'Operation failed. Do not start a failed restore target. Check Docker health, project ownership, backup integrity, and the operations guide; configuration values were not logged.',
    )
    process.exitCode = 1
  })
}
