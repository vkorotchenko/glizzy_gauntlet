import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeSync } from 'node:fs'
import {
  appendFile,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  backup,
  deploymentProblems,
  restore,
  validateBackup,
  validateMediaArchive,
  type Runner,
} from './operations.ts'

const temporary: string[] = []
const uuid = '00000000-0000-4000-8000-000000000001'
const names = `./\n./${uuid}.jpg`
const details = `drwxr-xr-x root/root 0 date ./\n-rw-r--r-- root/root 4 date ./${uuid}.jpg`
async function workspace() {
  const path = await mkdtemp(join(tmpdir(), 'glizzy-ops-unit-'))
  temporary.push(path)
  return path
}
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true })
})

function engine(project: string, running = true) {
  const state = {
    emptyDatabase: true,
    emptyMedia: true,
    failDump: false,
    failLock: false,
    volumeRoot: '',
    mediaNames: names,
  }
  const ids = {
    db: 'd'.repeat(12),
    api: 'a'.repeat(12),
    gateway: 'b'.repeat(12),
  }
  const run = vi.fn<Runner>(async (args, io) => {
    if (args[0] === 'ps') return Object.values(ids).join('\n')
    if (args[0] === 'inspect') {
      if (args[2].includes('.State.Health')) return 'healthy'
      const service = Object.entries(ids).find(
        ([, id]) => id === args.at(-1),
      )?.[0]
      return JSON.stringify({
        service,
        running: service === 'db' || running,
        paused: false,
        restarting: false,
        image: 'sha256:' + '1'.repeat(64),
        mounts:
          service === 'db'
            ? [
                {
                  Type: 'volume',
                  Destination: '/var/lib/postgresql/data',
                  Name: `${project}_database`,
                  Source: state.volumeRoot || undefined,
                },
              ]
            : service === 'api'
              ? [
                  {
                    Type: 'volume',
                    Destination: '/app/media',
                    Name: `${project}_media`,
                    Source: state.volumeRoot || undefined,
                  },
                ]
              : [],
      })
    }
    if (args[0] === 'volume')
      return JSON.stringify({
        'com.docker.compose.project': project,
        'com.docker.compose.volume': args.at(-1)?.endsWith('_media')
          ? 'media'
          : 'database',
      })
    if (args.includes('psql'))
      return args.at(-1) === 'SHOW server_version_num'
        ? '170011'
        : state.emptyDatabase
          ? 't'
          : 'f'
    if (args[0] === 'create') {
      if (state.failLock) throw new Error('Another operator holds the lock.')
      return 'e'.repeat(64)
    }
    if (args.includes('pg_dump')) {
      if (state.failDump) throw new Error('Synthetic dump failure')
      writeSync(io!.output!, 'database fixture')
    }
    if (args.includes('-cf')) writeSync(io!.output!, 'media fixture')
    if (args.includes('find')) return state.emptyMedia ? '' : '/media/existing'
    if (args.includes('-tf') || args.includes('-tvf')) {
      const listing = args.includes('-tf') ? state.mediaNames : details
      if (io?.output !== undefined) writeSync(io.output, listing + '\n')
      return listing
    }
    return ''
  })
  return { run, state, ids }
}

async function fixture() {
  const path = join(await workspace(), 'backup')
  const source = engine('source')
  await backup({ project: 'source', output: path }, source.run)
  return path
}

describe('consistent private backups and clean restores', () => {
  it('quiesces writers before both copies, writes a private completion manifest, and resumes in dependency order', async () => {
    const output = join(await workspace(), 'snapshot')
    const { run, ids } = engine('source')
    await backup({ project: 'source', output }, run)
    const calls = run.mock.calls.map(([args]) => args)
    const actions = calls.filter(
      (args) =>
        ['stop', 'start'].includes(args[0]) ||
        args.includes('pg_dump') ||
        args.includes('-cf'),
    )
    expect(
      actions.map((args) =>
        args[0] === 'run'
          ? 'media'
          : args.includes('pg_dump')
            ? 'dump'
            : `${args[0]}:${args.at(-1)}`,
      ),
    ).toEqual([
      `stop:${ids.gateway}`,
      `stop:${ids.api}`,
      'dump',
      'media',
      `start:${ids.api}`,
      `start:${ids.gateway}`,
    ])
    const { manifest } = await validateBackup(output)
    expect(Object.keys(manifest.files).sort()).toEqual([
      'database.dump',
      'media.tar',
    ])
    expect((await lstat(output)).mode & 0o077).toBe(0)
    expect((await lstat(join(output, 'manifest.json'))).mode & 0o077).toBe(0)
    expect(calls.at(-1)).toEqual(['rm', '--volumes', 'e'.repeat(64)])
  })

  it('resumes original services and never marks an interrupted backup complete', async () => {
    const output = join(await workspace(), 'failed')
    const { run, state, ids } = engine('source')
    state.failDump = true
    await expect(backup({ project: 'source', output }, run)).rejects.toThrow(
      'Maintenance failed',
    )
    expect(
      run.mock.calls
        .filter(([args]) => args[0] === 'start')
        .map(([args]) => args[1]),
    ).toEqual([ids.api, ids.gateway])
    await expect(lstat(join(output, 'manifest.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects concurrent maintenance before stopping any service', async () => {
    const { run, state } = engine('source')
    state.failLock = true
    await expect(
      backup(
        { project: 'source', output: join(await workspace(), 'snapshot') },
        run,
      ),
    ).rejects.toThrow('lock')
    expect(run.mock.calls.some(([args]) => args[0] === 'stop')).toBe(false)
  })

  it('refuses to write a snapshot inside a mounted data volume before stopping writers', async () => {
    const { run, state } = engine('source')
    state.volumeRoot = await realpath(await workspace())
    const output = join(state.volumeRoot, 'snapshot')
    await expect(backup({ project: 'source', output }, run)).rejects.toThrow(
      'outside the database and media',
    )
    expect(run.mock.calls.some(([args]) => args[0] === 'stop')).toBe(false)
    await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not publish a completion manifest for media that cannot safely be restored', async () => {
    const { run, state } = engine('source')
    state.mediaNames = './\n./unexpected-file.txt'
    const output = join(await workspace(), 'invalid-media')
    await expect(backup({ project: 'source', output }, run)).rejects.toThrow(
      'Maintenance failed',
    )
    await expect(lstat(join(output, 'manifest.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(run.mock.calls.filter(([args]) => args[0] === 'start')).toHaveLength(
      2,
    )
  })

  it('refuses private backups inside the checkout without invoking Docker', async () => {
    const run = vi.fn<Runner>()
    const output = fileURLToPath(new URL('../private-backup', import.meta.url))
    await expect(backup({ project: 'source', output }, run)).rejects.toThrow(
      'outside the repository',
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects corruption before touching a target project', async () => {
    const input = await fixture()
    await appendFile(join(input, 'database.dump'), 'tampered')
    const run = vi.fn<Runner>()
    await expect(restore({ project: 'target', input }, run)).rejects.toThrow(
      'checksum mismatch',
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects unexpected manifest filenames instead of following them', async () => {
    const input = await fixture()
    const path = join(input, 'manifest.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.files['../private-file'] = manifest.files['media.tar']
    await writeFile(path, JSON.stringify(manifest))
    await expect(validateBackup(input)).rejects.toThrow(
      'invalid backup manifest',
    )
  })

  it('never restores into the source project or a running target', async () => {
    const input = await fixture()
    const { run } = engine('target')
    await expect(restore({ project: 'source', input }, run)).rejects.toThrow(
      'never the source',
    )
    expect(run).not.toHaveBeenCalled()
    await expect(restore({ project: 'target', input }, run)).rejects.toThrow(
      'remain stopped',
    )
    expect(
      run.mock.calls.some(
        ([args]) => args[0] === 'stop' || args.includes('-xpf'),
      ),
    ).toBe(false)
  })

  it.each(['database', 'media'])(
    'refuses a populated target %s without extracting or dropping data',
    async (kind) => {
      const input = await fixture()
      const { run, state } = engine('target', false)
      if (kind === 'database') state.emptyDatabase = false
      else state.emptyMedia = false
      await expect(restore({ project: 'target', input }, run)).rejects.toThrow(
        `nonempty target ${kind}`,
      )
      expect(
        run.mock.calls.some(
          ([args]) => args.includes('-xpf') || args.includes('pg_restore'),
        ),
      ).toBe(false)
      expect(
        run.mock.calls.some(([args]) =>
          args.some((part) => /\bDROP\b/.test(part)),
        ),
      ).toBe(false)
    },
  )

  it('verifies names and types, extracts only into empty media, restores transactionally, and leaves writers stopped', async () => {
    const input = await fixture()
    const { run } = engine('target', false)
    await restore({ project: 'target', input }, run)
    const calls = run.mock.calls.map(([args]) => args)
    expect(calls.findIndex((args) => args.includes('-xpf'))).toBeLessThan(
      calls.findIndex((args) => args.includes('pg_restore')),
    )
    expect(calls.find((args) => args.includes('pg_restore'))).toEqual(
      expect.arrayContaining([
        '--single-transaction',
        '--exit-on-error',
        '--no-owner',
        '--no-acl',
      ]),
    )
    expect(
      calls.some((args) => args[0] === 'start' || args.includes('--clean')),
    ).toBe(false)
  })

  it('rejects traversal, absolute paths, symlinks, and hardlinks in otherwise checksummed archives', () => {
    expect(() => validateMediaArchive(names, details)).not.toThrow()
    for (const path of [
      '../escape.jpg',
      '/absolute.jpg',
      './nested/file.jpg',
      './not-a-uuid.jpg',
    ])
      expect(() => validateMediaArchive(`./\n${path}`, details)).toThrow(
        'traversal',
      )
    for (const type of ['l', 'h'])
      expect(() =>
        validateMediaArchive(names, details.replace('-rw-', `${type}rw-`)),
      ).toThrow('links')
  })
})

describe('redacted production preflight', () => {
  const config = () => ({
    services: {
      db: {
        environment: {
          POSTGRES_PASSWORD: 'a-long-synthetic-database-value-1234',
        },
      },
      api: {
        environment: {
          PUBLIC_BASE_URL: 'https://crew.duckdns.org',
          GOOGLE_ENABLED: 'true',
          GOOGLE_CLIENT_ID: '123.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'synthetic-provider-value',
          EMAIL_ENABLED: 'true',
          MAIL_FROM: 'robot@crew.tld',
          SMTP_HOST: 'mail.provider.tld',
          SMTP_PORT: '587',
          SMTP_AUTH: 'true',
          SMTP_STARTTLS: 'true',
          SMTP_USERNAME: 'synthetic-sender',
          SMTP_PASSWORD: 'synthetic-mail-value',
        },
      },
      gateway: {},
      caddy: {
        environment: { PUBLIC_HOSTNAME: 'crew.duckdns.org' },
        ports: [
          { target: 80, published: '80' },
          { target: 443, published: '443' },
        ],
      },
    },
  })
  it('accepts a structurally configured Linux deployment without claiming provider or host certification', () => {
    expect(
      deploymentProblems(config(), { platform: 'linux', arch: 'arm64' }),
    ).toEqual([])
  })
  it('rejects a development override, insecure origin/cookies, example credentials, and unsupported hosts without echoing values', () => {
    const settings = config()
    Object.assign(settings.services.api.environment, {
      PUBLIC_BASE_URL: 'http://127.0.0.1:3000',
      COOKIE_SECURE: 'false',
      SMTP_STARTTLS: 'false',
      SMTP_PASSWORD: 'do-not-echo-this-value',
    })
    Object.assign(settings.services.db, {
      ports: [{ target: 5432, published: '5432' }],
    })
    settings.services.db.environment.POSTGRES_PASSWORD =
      'replace-with-a-random-local-password'
    const problems = deploymentProblems(settings, {
      platform: 'darwin',
      arch: 'arm',
    })
    expect(problems.join('\n')).toMatch(/HOST:/)
    expect(problems.join('\n')).toMatch(/PUBLIC_BASE_URL:/)
    expect(problems.join('\n')).toMatch(/COOKIE_SECURE:/)
    expect(problems.join('\n')).toMatch(/POSTGRES_PASSWORD:/)
    expect(problems.join('\n')).toMatch(/PORTS: db/)
    expect(problems.join('\n')).toMatch(/authenticated STARTTLS/)
    expect(problems.join('\n')).not.toContain('do-not-echo-this-value')
  })
})
