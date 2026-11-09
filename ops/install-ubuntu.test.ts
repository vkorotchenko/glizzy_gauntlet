import { spawnSync } from 'node:child_process'
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('./install-ubuntu.sh', import.meta.url))
const template = fileURLToPath(new URL('../.env.example', import.meta.url))
const composeAvailable =
  spawnSync('docker', ['compose', 'version']).status === 0
const temporary: string[] = []
type Call = { command: string; args: string[]; input: string }

afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true })
})

async function workspace() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'glizzy-ubuntu-unit-')),
  )
  temporary.push(root)
  const repo = join(root, 'checkout with spaces')
  const bin = join(root, 'bin')
  const log = join(root, 'commands.jsonl')
  await Promise.all([
    mkdir(join(repo, 'ops'), { recursive: true }),
    mkdir(join(repo, 'infra'), { recursive: true }),
    mkdir(bin),
  ])
  await Promise.all([
    copyFile(script, join(repo, 'ops/install-ubuntu.sh')),
    copyFile(template, join(repo, '.env.example')),
    writeFile(join(repo, 'package-lock.json'), '{}'),
    writeFile(join(repo, 'infra/compose.yaml'), ''),
    writeFile(log, ''),
  ])
  const recorder = join(root, 'record.cjs')
  await writeFile(
    recorder,
    `const fs = require('node:fs')
let [command, ...args] = process.argv.slice(2)
if (command === 'sudo') {
  if (args[0] === '-v') process.exit(0)
  ;[command, ...args] = args
}
const input = command === 'tee' ? fs.readFileSync(0, 'utf8') : ''
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify({ command, args, input }) + '\\n')
if (command === process.env.FAIL_COMMAND) process.exit(9)
if (command === 'uname') console.log(process.env.TEST_PLATFORM)
if (command === 'dpkg') console.log(process.env.TEST_ARCH)
if (command === 'id') console.log(args[0] === '-u' ? process.env.TEST_UID : 'operator')
if (command === 'awk') console.log(args[1].includes('"ID"') ? process.env.TEST_OS : process.env.TEST_CODENAME)
if (command === 'node') console.log(process.env.TEST_NODE)
if (command === 'openssl') {
  if (process.env.RACE_CONFIG === 'directory') fs.mkdirSync('.env')
  console.log('synthetic-database-password-never-display')
}
if (command === 'ln') fs.linkSync(args.at(-2), args.at(-1))
if (command === 'mv') fs.renameSync(args.at(-2), args.at(-1))
if (command === 'ip') console.log(args.includes('route') ? process.env.TEST_ROUTE : process.env.TEST_LINK)
if (command === 'docker' && args.includes('config') && process.env.RACE_CONFIG === 'edit') fs.appendFileSync('.env', '# concurrent edit\\n')
if (command === 'curl' || command === 'gpg') fs.writeFileSync(args[args.indexOf('-o') + 1], 'synthetic public signing key')
`,
  )
  await Promise.all(
    [
      'sudo',
      'uname',
      'dpkg',
      'id',
      'awk',
      'curl',
      'gpg',
      'node',
      'npm',
      'openssl',
      'ln',
      'mv',
      'ip',
    ].map((command) =>
      writeFile(
        join(bin, command),
        `#!/bin/sh\nexec "${process.execPath}" -- "${recorder}" "${command}" "$@"\n`,
        { mode: 0o700 },
      ),
    ),
  )
  return {
    repo,
    run(
      args = ['--domain', 'glizzy-gauntlet.com'],
      environment: NodeJS.ProcessEnv = {},
      input = '',
    ) {
      return spawnSync('bash', [join(repo, 'ops/install-ubuntu.sh'), ...args], {
        cwd: root,
        encoding: 'utf8',
        timeout: 15000,
        input,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          COMMAND_LOG: log,
          TEST_PLATFORM: 'Linux',
          TEST_ARCH: 'amd64',
          TEST_UID: '1000',
          TEST_OS: 'ubuntu',
          TEST_CODENAME: 'noble',
          TEST_NODE: 'v24.11.0',
          SSH_CONNECTION: '',
          FAIL_COMMAND: '',
          RACE_CONFIG: '',
          TEST_ROUTE: '1.1.1.1 via 192.0.2.1 dev ens3 src 192.0.2.10',
          TEST_LINK:
            '2: ens3: <UP> link/ether 02:00:00:00:00:01 brd ff:ff:ff:ff:ff:ff',
          ...environment,
        },
      })
    },
    async calls(): Promise<Call[]> {
      return (await readFile(log, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Call)
    },
  }
}

describe('Ubuntu host bootstrap', () => {
  it('creates private production configuration, installs signed repositories, and does not deploy or change the firewall by default', async () => {
    const host = await workspace()
    const result = host.run()
    expect(result.status, result.stderr).toBe(0)
    const config = await readFile(join(host.repo, '.env'), 'utf8')
    expect(config).toContain('PUBLIC_HOSTNAME=glizzy-gauntlet.com\n')
    expect(config).toContain('PUBLIC_BASE_URL=https://glizzy-gauntlet.com\n')
    expect(config).toContain(
      'POSTGRES_PASSWORD=synthetic-database-password-never-display\n',
    )
    expect(config).toContain('EMAIL_ENABLED=false\n')
    expect(config).toContain('GOOGLE_ENABLED=false\n')
    expect((await lstat(join(host.repo, '.env'))).mode & 0o777).toBe(0o600)
    expect(result.stdout + result.stderr).not.toContain(
      'synthetic-database-password-never-display',
    )
    const calls = await host.calls()
    expect(
      calls.find(
        (call) =>
          call.command === 'tee' &&
          call.args[0] === '/etc/apt/sources.list.d/docker.sources',
      )?.input,
    ).toContain('Architectures: amd64\n')
    expect(
      calls.find(
        (call) =>
          call.command === 'tee' &&
          call.args[0] === '/etc/apt/sources.list.d/nodesource.list',
      )?.input,
    ).toContain('node_24.x nodistro main')
    expect(
      calls.filter((call) => call.command === 'npm').map((call) => call.args),
    ).toEqual([['ci']])
    expect(calls.some((call) => call.command === 'ufw')).toBe(false)
    expect(
      calls.some((call) =>
        call.args.some((arg) => ['up', 'down', 'deploy'].includes(arg)),
      ),
    ).toBe(false)
    expect(
      (await readdir(host.repo)).some((name) =>
        name.startsWith('.env.install.'),
      ),
    ).toBe(false)
  })

  it('preserves existing configuration and its database password on reruns', async () => {
    const host = await workspace()
    expect(host.run().status).toBe(0)
    const path = join(host.repo, '.env')
    const original =
      'PUBLIC_HOSTNAME=existing.invalid\nPOSTGRES_PASSWORD=synthetic-existing\n'
    await writeFile(path, original)
    const result = host.run()
    expect(result.status, result.stderr).toBe(0)
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(result.stdout).toContain('Existing .env preserved')
    expect(result.stdout + result.stderr).not.toContain('synthetic-existing')
    expect(
      (await host.calls()).filter((call) => call.command === 'openssl'),
    ).toHaveLength(1)
  })

  it('allows the explicitly selected SSH port before enabling UFW and supports ARM64', async () => {
    const host = await workspace()
    const result = host.run(
      ['--domain', 'glizzy-gauntlet.com', '--ssh-port', '2222'],
      {
        TEST_ARCH: 'arm64',
        SSH_CONNECTION: '192.0.2.1 40000 192.0.2.2 2222',
      },
    )
    expect(result.status, result.stderr).toBe(0)
    const calls = await host.calls()
    expect(
      calls.filter((call) => call.command === 'ufw').map((call) => call.args),
    ).toEqual([
      ['allow', '2222/tcp'],
      ['allow', '80/tcp'],
      ['allow', '443/tcp'],
      ['default', 'deny', 'incoming'],
      ['default', 'allow', 'outgoing'],
      ['--force', 'enable'],
    ])
    expect(calls.find((call) => call.command === 'tee')?.input).toContain(
      'Architectures: arm64\n',
    )
  })

  it.each([
    [[], {}],
    [['--domain', 'https://glizzy-gauntlet.com'], {}],
    [['--domain', 'glizzy-gauntlet.com', '--ssh-port', '0'], {}],
    [['--domain', 'glizzy-gauntlet.com', '--ssh-port', '65536'], {}],
    [
      ['--domain', 'glizzy-gauntlet.com', '--ssh-port', '22'],
      { SSH_CONNECTION: '192.0.2.1 40000 192.0.2.2 2222' },
    ],
    [['--domain', 'glizzy-gauntlet.com'], { TEST_PLATFORM: 'Darwin' }],
    [['--domain', 'glizzy-gauntlet.com'], { TEST_UID: '0' }],
    [['--domain', 'glizzy-gauntlet.com'], { TEST_OS: 'debian' }],
    [['--domain', 'glizzy-gauntlet.com'], { TEST_CODENAME: 'focal' }],
    [['--domain', 'glizzy-gauntlet.com'], { TEST_ARCH: 'armhf' }],
  ] satisfies [string[], NodeJS.ProcessEnv][])(
    'rejects invalid arguments or unsupported hosts before mutations (%j, %j)',
    async (args, environment) => {
      const host = await workspace()
      expect(host.run(args, environment).status).not.toBe(0)
      expect(
        (await host.calls()).some((call) =>
          ['apt-get', 'install', 'tee', 'ufw', 'usermod', 'npm'].includes(
            call.command,
          ),
        ),
      ).toBe(false)
    },
  )

  it('shows help without host checks and refuses a symlinked configuration before installing packages', async () => {
    const host = await workspace()
    expect(host.run(['--help']).status).toBe(0)
    expect(await host.calls()).toEqual([])
    const target = join(host.repo, 'untouched')
    await writeFile(target, 'synthetic private fixture')
    await symlink(target, join(host.repo, '.env'))
    expect(host.run().status).not.toBe(0)
    expect(await readFile(target, 'utf8')).toBe('synthetic private fixture')
    expect(
      (await host.calls()).some((call) => call.command === 'apt-get'),
    ).toBe(false)
  })

  it('refuses to publish configuration into a directory created by a racing writer', async () => {
    const host = await workspace()
    const result = host.run(undefined, { RACE_CONFIG: 'directory' })
    expect(result.status).not.toBe(0)
    expect(await readdir(join(host.repo, '.env'))).toEqual([])
  })

  it('stops before installing app dependencies if the wrong Node major is selected', async () => {
    const host = await workspace()
    const result = host.run(undefined, { TEST_NODE: 'v25.0.0' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Node.js 24 is required')
    expect((await host.calls()).some((call) => call.command === 'npm')).toBe(
      false,
    )
  })

  it.each(['curl', 'npm', 'openssl'])(
    'stops on %s failure without publishing a partial configuration or enabling the firewall',
    async (command) => {
      const host = await workspace()
      const result = host.run(
        ['--domain', 'glizzy-gauntlet.com', '--ssh-port', '22'],
        { FAIL_COMMAND: command },
      )
      expect(result.status).not.toBe(0)
      await expect(lstat(join(host.repo, '.env'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      expect((await host.calls()).some((call) => call.command === 'ufw')).toBe(
        false,
      )
      expect(
        (await readdir(host.repo)).some((name) =>
          name.startsWith('.env.install.'),
        ),
      ).toBe(false)
    },
  )

  it('configures providers privately and guides router-side reservation without changing networking', async () => {
    const host = await workspace()
    const password =
      'synthetic $NOT_EXPANDED ${ALSO_NOT_EXPANDED} # "quote" \'apostrophe\' \\'
    const googleSecret = 'synthetic-google-secret'
    const result = host.run(
      ['--interactive', '--configure-only'],
      {},
      [
        '',
        'y',
        'smtp.example.test',
        '465',
        '587',
        'sender@example.test',
        'smtp-user',
        password,
        'y',
        'synthetic.apps.googleusercontent.com',
        googleSecret,
        '1024',
        'n',
        'y',
        'n',
      ].join('\n') + '\n',
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain('Enter a STARTTLS port')
    const config = await readFile(join(host.repo, '.env'), 'utf8')
    expect(config).toContain(
      'EMAIL_ENABLED=true\nSMTP_AUTH=true\nSMTP_STARTTLS=true\n',
    )
    expect(config).toContain('GOOGLE_ENABLED=true\n')
    expect(config).toContain('MEDIA_MAX_BYTES="1073741824"')
    expect((await lstat(join(host.repo, '.env'))).mode & 0o777).toBe(0o600)
    expect(result.stdout + result.stderr).not.toContain(password)
    expect(result.stdout + result.stderr).not.toContain(googleSecret)
    expect(result.stdout).toContain('Current LAN IPv4: 192.0.2.10')
    expect(result.stdout).toContain('MAC address: 02:00:00:00:00:01')
    expect(result.stdout).toContain('Reservation remains pending')
    const calls = await host.calls()
    expect(JSON.stringify(calls)).not.toContain(password)
    expect(JSON.stringify(calls)).not.toContain(googleSecret)
    expect(
      calls.some((call) => ['apt-get', 'npm', 'ufw'].includes(call.command)),
    ).toBe(false)
    expect(
      calls.filter((call) => call.command === 'ip').map((call) => call.args),
    ).toEqual([
      ['-4', 'route', 'get', '1.1.1.1'],
      ['-o', 'link', 'show', 'dev', 'ens3'],
    ])
    if (composeAvailable) {
      const compose = join(host.repo, 'literal-compose.yaml')
      await writeFile(
        compose,
        'services:\n  probe:\n    image: busybox\n    environment:\n      SMTP_PASSWORD: ${SMTP_PASSWORD}\n      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}\n',
      )
      // Config JSON re-escapes dollars; inspect the actual interpolation environment.
      const parsed = spawnSync(
        'docker',
        [
          'compose',
          '--env-file',
          join(host.repo, '.env'),
          '-f',
          compose,
          'config',
          '--environment',
        ],
        {
          cwd: host.repo,
          encoding: 'utf8',
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
        },
      )
      expect(
        parsed.status,
        'Real Compose parsing of synthetic credentials failed',
      ).toBe(0)
      const environment = parsed.stdout.split('\n')
      expect(environment).toContain(`SMTP_PASSWORD=${password}`)
      expect(environment).toContain(`GOOGLE_CLIENT_SECRET=${googleSecret}`)
    }
  })

  it.each([false, true])(
    'requires consent to update existing configuration (consent: %s)',
    async (consent) => {
      const host = await workspace()
      const path = join(host.repo, '.env')
      const original =
        'POSTGRES_PASSWORD=synthetic-existing\nSMTP_PASSWORD=synthetic-existing-smtp\nCUSTOM_SETTING=keep-me\n'
      await writeFile(path, original)
      const input = consent
        ? ['', 'y', 'n', 'n', '', 'n', 'n']
        : ['', 'n', 'n', 'n']
      const result = host.run(
        ['--interactive', '--configure-only'],
        {},
        input.join('\n') + '\n',
      )
      expect(result.status, result.stderr).toBe(0)
      const updated = await readFile(path, 'utf8')
      if (consent) {
        expect(updated.startsWith(original)).toBe(true)
        expect(updated).toContain(
          'PUBLIC_BASE_URL="https://glizzy-gauntlet.com"',
        )
      } else {
        expect(updated).toBe(original)
      }
      expect(result.stdout + result.stderr).not.toContain('synthetic-existing')
      expect(
        (await host.calls()).some((call) => call.command === 'openssl'),
      ).toBe(false)
    },
  )

  it.each(['reject', 'edit'])(
    'preserves existing configuration on candidate failure or concurrent edits (%s)',
    async (failure) => {
      const host = await workspace()
      const path = join(host.repo, '.env')
      const original = 'POSTGRES_PASSWORD=synthetic-existing\n'
      await writeFile(path, original)
      const result = host.run(
        ['--interactive', '--configure-only'],
        failure === 'reject'
          ? { FAIL_COMMAND: 'docker' }
          : { RACE_CONFIG: 'edit' },
        ['', 'y', 'n', 'n', '', 'n', 'n'].join('\n') + '\n',
      )
      expect(result.status).not.toBe(0)
      expect(await readFile(path, 'utf8')).toBe(
        original + (failure === 'edit' ? '# concurrent edit\n' : ''),
      )
    },
  )

  it('handles unavailable network discovery without claiming a reservation', async () => {
    const host = await workspace()
    const result = host.run(
      ['--interactive', '--configure-only'],
      { TEST_ROUTE: '' },
      ['', 'n', 'n', '', 'n', 'y'].join('\n') + '\n',
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('no reservation has been made')
  })

  it('cancels on incomplete input before package or configuration changes', async () => {
    const host = await workspace()
    const result = host.run(['--interactive'], {}, '\ny\n')
    expect(result.status).not.toBe(0)
    await expect(lstat(join(host.repo, '.env'))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    expect(
      (await host.calls()).some((call) => call.command === 'apt-get'),
    ).toBe(false)
  })

  it('validates the SSH port entered in the wizard before enabling the firewall', async () => {
    const host = await workspace()
    const result = host.run(
      ['--interactive', '--configure-only'],
      { SSH_CONNECTION: '192.0.2.1 40000 192.0.2.10 2222' },
      ['', 'n', 'n', '', 'y', '22', '2222', 'n'].join('\n') + '\n',
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain('matching the current SSH session')
    const calls = (await host.calls()).filter((call) => call.command === 'ufw')
    expect(calls[0].args).toEqual(['allow', '2222/tcp'])
    expect(calls.at(-1)?.args).toEqual(['--force', 'enable'])
  })
})
