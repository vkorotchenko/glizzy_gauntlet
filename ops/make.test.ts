import { spawnSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const makefile = fileURLToPath(new URL('../Makefile', import.meta.url))
const temporary: string[] = []
type Call = { command: string; args: string[]; cwd: string }

afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true })
})

async function workspace() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'glizzy-make-unit-')),
  )
  temporary.push(root)
  const bin = join(root, 'bin')
  const log = join(root, 'commands.jsonl')
  await mkdir(bin)
  await mkdir(join(root, 'services/api'), { recursive: true })
  await copyFile(makefile, join(root, 'Makefile'))
  await writeFile(log, '')
  const recorder = join(root, 'record.cjs')
  await writeFile(
    recorder,
    `const fs = require('node:fs')
const command = process.argv[2]
const args = process.argv.slice(3)
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify({ command, args, cwd: process.cwd() }) + '\\n')
if (command === process.env.FAIL_COMMAND && args.includes(process.env.FAIL_ARGUMENT)) process.exit(9)
`,
  )
  await Promise.all(
    ['npm', 'docker', 'gh', 'mvn'].map((name) =>
      writeFile(
        join(bin, name),
        `#!/bin/sh\nexec "${process.execPath}" -- "${recorder}" "${name}" "$@"\n`,
        { mode: 0o700 },
      ),
    ),
  )
  return {
    root,
    run(
      target = '',
      variables: string[] = [],
      environment: NodeJS.ProcessEnv = {},
    ) {
      return spawnSync(
        'make',
        [
          '--no-print-directory',
          '-j4',
          'MVN=mvn',
          ...(target ? [target] : []),
          ...variables,
        ],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 10000,
          env: {
            ...process.env,
            PATH: `${bin}${delimiter}${process.env.PATH}`,
            COMMAND_LOG: log,
            ARGS: '',
            OPS_PROJECT: '',
            BACKUP_DIR: '',
            RUN_ID: '',
            FAIL_COMMAND: '',
            FAIL_ARGUMENT: '',
            MAKEFLAGS: '',
            MFLAGS: '',
            MAKEOVERRIDES: '',
            ...environment,
          },
        },
      )
    },
    async calls(): Promise<Call[]> {
      return (await readFile(log, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Call)
    },
  }
}

async function deploymentWorkspace(branch = 'main') {
  const make = await workspace()
  function git(args: string[], cwd = make.root) {
    const result = spawnSync(
      'git',
      [
        '-c',
        'user.name=Deployment Test',
        '-c',
        'user.email=deployment@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        ...args,
      ],
      { cwd, encoding: 'utf8', timeout: 10000 },
    )
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim()
  }
  await writeFile(
    join(make.root, '.gitignore'),
    '/bin/\n/commands.jsonl\n/record.cjs\n/origin.git/\n/publisher/\n',
  )
  git(['init', '--quiet', '--initial-branch', branch])
  git(['add', 'Makefile', '.gitignore'])
  git(['commit', '--quiet', '-m', 'Initial deployment'])
  const previous = git(['rev-parse', 'HEAD'])
  const origin = join(make.root, 'origin.git')
  git(['init', '--quiet', '--bare', origin])
  git(['remote', 'add', 'origin', origin])
  git(['push', '--quiet', 'origin', branch])
  const publisher = join(make.root, 'publisher')
  git(['clone', '--quiet', '--branch', branch, origin, publisher])
  await writeFile(join(publisher, 'release.txt'), 'new release\n')
  git(['add', 'release.txt'], publisher)
  git(['commit', '--quiet', '-m', 'Next release'], publisher)
  git(['push', '--quiet', 'origin', branch], publisher)
  const latest = git(['rev-parse', 'HEAD'], publisher)
  return { ...make, git, previous, latest }
}

describe('Make command safety and orchestration', () => {
  it('defaults to help without installing, deploying, or contacting providers', async () => {
    const make = await workspace()
    const result = make.run()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Glizzy Gauntlet commands')
    expect(await make.calls()).toEqual([])
  })

  it.each(['dev', 'watch'])(
    'runs %s as frontend-only hot reload and propagates a failed watcher',
    async (target) => {
      const make = await workspace()
      const result = make.run(target)
      expect(result.status, result.stderr).toBe(0)
      expect(await make.calls()).toEqual([
        { command: 'npm', args: ['run', 'watch'], cwd: make.root },
      ])
      const failure = make.run(target, [], {
        FAIL_COMMAND: 'npm',
        FAIL_ARGUMENT: 'watch',
      })
      expect(failure.status).not.toBe(0)
      expect((await make.calls()).map((call) => call.command)).toEqual([
        'npm',
        'npm',
      ])
    },
  )

  it.each(['none', 'preflight', 'build', 'up'])(
    'builds before replacing production containers and stops on failure (%s)',
    async (failure) => {
      const make = await workspace()
      const config = '/private/config with spaces.env'
      const result = make.run(
        'deploy',
        [`ENV_FILE=${config}`, 'PROD_PROJECT=release-test'],
        failure === 'none'
          ? {}
          : {
              FAIL_COMMAND: failure === 'preflight' ? 'npm' : 'docker',
              FAIL_ARGUMENT: failure,
            },
      )
      const calls = await make.calls()
      expect(calls[0].args).toEqual([
        'run',
        'ops',
        '--',
        'preflight',
        '--env-file',
        config,
      ])
      if (failure === 'preflight') {
        expect(result.status).not.toBe(0)
        expect(calls.map((call) => call.command)).toEqual(['npm'])
      } else {
        expect(calls.map((call) => call.command)).toEqual(
          failure === 'build' ? ['npm', 'docker'] : ['npm', 'docker', 'docker'],
        )
        expect(calls[1].args).toEqual([
          'compose',
          '--project-name',
          'release-test',
          '--env-file',
          config,
          '-f',
          'infra/compose.yaml',
          '--profile',
          'public',
          'build',
          'api',
          'gateway',
        ])
        if (failure !== 'build')
          expect(calls[2].args).toEqual([
            ...calls[1].args.slice(0, -3),
            'up',
            '--no-build',
            '--detach',
            '--wait',
          ])
      }
      if (failure === 'none') expect(result.status, result.stderr).toBe(0)
      else expect(result.status).not.toBe(0)
    },
  )

  it.each(['main', 'master'])(
    'deploys the fetched %s commit in order, preserving production overrides',
    async (branch) => {
      const make = await deploymentWorkspace(branch)
      const config = '/private/config with spaces.env'
      const result = make.run('deploy-latest', [
        ...(branch === 'main' ? [] : [`DEPLOY_BRANCH=${branch}`]),
        `ENV_FILE=${config}`,
        'PROD_PROJECT=release-test',
      ])
      expect(result.status, result.stderr).toBe(0)
      expect(make.git(['rev-parse', 'HEAD'])).toBe(make.latest)
      expect(make.git(['branch', '--show-current'])).toBe(branch)
      expect(result.stdout).toContain(make.latest)
      const calls = await make.calls()
      expect(
        calls.map((call) => [call.command, ...call.args.slice(0, 3)]),
      ).toEqual([
        ['npm', 'ci'],
        ['npm', 'run', 'ops', '--'],
        ['docker', 'compose', '--project-name', 'release-test'],
        ['docker', 'compose', '--project-name', 'release-test'],
      ])
      expect(calls[1].args).toContain(config)
      for (const call of calls.slice(2)) expect(call.args).toContain(config)
      expect(calls[2].args.slice(-3)).toEqual(['build', 'api', 'gateway'])
      expect(calls[3].args.slice(-4)).toEqual([
        'up',
        '--no-build',
        '--detach',
        '--wait',
      ])
    },
  )

  it.each(['tracked', 'staged', 'untracked'])(
    'refuses a %s change without updating or deploying the checkout',
    async (change) => {
      const make = await deploymentWorkspace()
      await writeFile(
        join(make.root, change === 'untracked' ? 'local.txt' : 'Makefile'),
        '# local changes\n',
        { flag: 'a' },
      )
      if (change === 'staged') make.git(['add', 'Makefile'])
      const result = make.run('deploy-latest')
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('clean checkout')
      expect(make.git(['rev-parse', 'HEAD'])).toBe(make.previous)
      expect(await make.calls()).toEqual([])
    },
  )

  it.each(['branch', 'detached', 'ahead', 'diverged', 'fetch'])(
    'refuses an unsafe or unavailable source (%s) before installing or deploying',
    async (state) => {
      const make = await deploymentWorkspace()
      if (state === 'branch') make.git(['switch', '-c', 'other'])
      if (state === 'detached') make.git(['checkout', '--detach'])
      if (state === 'fetch')
        make.git(['remote', 'set-url', 'origin', join(make.root, 'missing')])
      if (state === 'ahead' || state === 'diverged') {
        if (state === 'ahead') {
          make.git(['fetch', '--quiet', 'origin', 'main'])
          make.git(['merge', '--ff-only', 'FETCH_HEAD'])
        }
        await writeFile(join(make.root, 'local.txt'), 'local commit\n')
        make.git(['add', 'local.txt'])
        make.git(['commit', '--quiet', '-m', 'Local-only change'])
      }
      const before = make.git(['rev-parse', 'HEAD'])
      const result = make.run('deploy-latest')
      expect(result.status).not.toBe(0)
      expect(make.git(['rev-parse', 'HEAD'])).toBe(before)
      expect(await make.calls()).toEqual([])
    },
  )

  it('does not deploy if refreshed dependencies fail to install', async () => {
    const make = await deploymentWorkspace()
    const result = make.run('deploy-latest', [], {
      FAIL_COMMAND: 'npm',
      FAIL_ARGUMENT: 'ci',
    })
    expect(result.status).not.toBe(0)
    expect(make.git(['rev-parse', 'HEAD'])).toBe(make.latest)
    expect(await make.calls()).toEqual([
      { command: 'npm', args: ['ci'], cwd: make.root },
    ])
  })

  it('stops only the selected local stack without deleting its volumes', async () => {
    const make = await workspace()
    const result = make.run('down', [
      'PROJECT=disposable',
      'ENV_FILE=.env.example',
    ])
    expect(result.status, result.stderr).toBe(0)
    const [call] = await make.calls()
    expect(call.command).toBe('docker')
    expect(call.args).toEqual([
      'compose',
      '--project-name',
      'disposable',
      '--env-file',
      '.env.example',
      '-f',
      'infra/compose.yaml',
      '-f',
      'infra/compose.dev.yaml',
      'down',
    ])
  })

  it.each(['backup', 'restore'])(
    'refuses %s without both an explicit project and backup directory',
    async (target) => {
      const make = await workspace()
      for (const variables of [
        ['OPS_PROJECT=fresh-target'],
        ['BACKUP_DIR=/private/snapshot'],
      ]) {
        const result = make.run(target, variables)
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('Set OPS_PROJECT and BACKUP_DIR')
      }
      expect(await make.calls()).toEqual([])
    },
  )

  it.each([false, true])(
    'runs CI in order without bypassing a failed check (failure: %s)',
    async (fail) => {
      const make = await workspace()
      const result = make.run(
        'ci',
        [],
        fail ? { FAIL_COMMAND: 'npm', FAIL_ARGUMENT: 'check' } : {},
      )
      const calls = await make.calls()
      expect(calls.map((call) => [call.command, ...call.args])).toEqual(
        fail
          ? [['npm', 'run', 'check']]
          : [
              ['npm', 'run', 'check'],
              ['npm', 'run', 'build'],
              ['mvn', '-B', 'verify'],
            ],
      )
      if (fail) expect(result.status).not.toBe(0)
      else {
        expect(result.status).toBe(0)
        expect(calls[2].cwd).toBe(join(make.root, 'services/api'))
      }
    },
  )

  it('requires an explicit workflow run and propagates a failed watch', async () => {
    const make = await workspace()
    expect(make.run('ci-watch').status).not.toBe(0)
    expect(await make.calls()).toEqual([])
    const result = make.run('ci-watch', ['RUN_ID=123'], {
      FAIL_COMMAND: 'gh',
      FAIL_ARGUMENT: '--exit-status',
    })
    expect(result.status).not.toBe(0)
    expect((await make.calls())[0]).toMatchObject({
      command: 'gh',
      args: ['run', 'watch', '123', '--exit-status'],
    })
  })
})
