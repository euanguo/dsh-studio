import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  defaultEnvironmentCache,
  environmentFingerprint,
  findUserExecutable,
  parseLoginShellEnvironment,
  resolveUserEnvironment,
  userEnvironmentDiagnostics,
  type EnvironmentCache,
  type EnvironmentCacheRecord,
} from '../src/user-environment.ts'

test('login-shell environment parsing ignores startup chatter and invalid entries', () => {
  const parsed = parseLoginShellEnvironment(Buffer.from([
    'zsh: warning\0',
    '__DSH_ENV_BEGIN__\0',
    'PATH=/Users/me/.local/bin:/usr/bin\0',
    'HOME=/Users/me\0',
    'INVALID-KEY=value\0',
    'EDITOR=vi=like\0',
    'PWD=/stale\0',
    'OLDPWD=/also-stale\0',
    'SHLVL=99\0',
    '_=/usr/bin/env\0',
    '__DSH_ENV_END__\0',
    'after-marker=ignored\0',
  ].join('')))
  assert.deepEqual(parsed, {
    EDITOR: 'vi=like',
    HOME: '/Users/me',
    PATH: '/Users/me/.local/bin:/usr/bin',
  })
})

test('user environment resolution merges login-shell values without mutating the base', async () => {
  const base = {
    HOME: '/Users/me',
    PATH: '/usr/bin',
    BASE_ONLY: 'yes',
    PWD: '/stale-base',
    SHLVL: '3',
  }
  let invocation: { args: readonly string[]; env: NodeJS.ProcessEnv; shell: string } | undefined
  const result = await resolveUserEnvironment({
    base,
    loginShell: '/bin/zsh',
    platform: 'darwin',
    runLoginShell: async (shell, args, env) => {
      invocation = { args, env, shell }
      return {
        output: Buffer.from('__DSH_ENV_BEGIN__\0PATH=/Users/me/.n/bin:/usr/bin\0HOME=/Users/me\0CODEX_HOME=/Users/me/.codex\0__DSH_ENV_END__\0'),
        status: 0,
      }
    },
  })
  assert.equal(result.source, 'login-shell')
  assert.equal(result.shell, '/bin/zsh')
  assert.equal(result.env.PATH, '/Users/me/.n/bin:/usr/bin')
  assert.equal(result.env.CODEX_HOME, '/Users/me/.codex')
  assert.equal(result.env.SHELL, '/bin/zsh')
  assert.equal(result.env.PWD, undefined)
  assert.equal(result.env.OLDPWD, undefined)
  assert.equal(result.env.SHLVL, undefined)
  assert.equal(result.env._, undefined)
  assert.equal(base.PATH, '/usr/bin')
  assert.deepEqual(invocation?.args, [
    '-ilc',
    "printf '__DSH_ENV_BEGIN__\\0'; command env -0; printf '__DSH_ENV_END__\\0'",
  ])
  assert.match(invocation?.env.PATH ?? '', /\/opt\/homebrew\/bin/)
})

test('user environment resolution falls back when the login shell times out', async () => {
  const result = await resolveUserEnvironment({
    base: { HOME: '/Users/me', PATH: '/usr/bin', SHELL: '/bin/zsh' },
    runLoginShell: async () => ({
      output: Buffer.alloc(0),
      status: null,
      timedOut: true,
    }),
  })
  assert.equal(result.source, 'process')
  assert.equal(result.issue, 'timeout')
  assert.equal(result.env.PATH, '/usr/bin')
})

test('Windows environment resolution keeps the GUI environment and reports ComSpec', async () => {
  const result = await resolveUserEnvironment({
    base: {
      Path: 'C:\\Users\\me\\bin;C:\\Windows\\System32',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    },
    platform: 'win32',
  })
  assert.equal(result.source, 'process')
  assert.equal(result.shell, 'C:\\Windows\\System32\\cmd.exe')
  assert.equal(result.env.Path, 'C:\\Users\\me\\bin;C:\\Windows\\System32')
})

test('Windows command lookup honors Path and PATHEXT', () => {
  const executable = findUserExecutable(
    'codex',
    { Path: 'C:\\Tools', PATHEXT: '.EXE;.CMD' },
    'win32',
    path => path === 'C:\\Tools\\codex.CMD',
  )
  assert.equal(executable, 'C:\\Tools\\codex.CMD')
})

test('user executable lookup and diagnostics expose only safe command metadata', () => {
  const resolution = {
    env: { PATH: '/Users/me/.local/bin:/Users/me/.n/bin' },
    shell: '/bin/zsh',
    source: 'login-shell' as const,
  }
  const executable = findUserExecutable('codex', resolution.env, 'darwin', path => path === '/Users/me/.local/bin/codex')
  assert.equal(executable, '/Users/me/.local/bin/codex')
  assert.equal(findUserExecutable('pi', resolution.env, 'darwin', () => false), null)
  assert.deepEqual(userEnvironmentDiagnostics(resolution), [
    'environment=login-shell',
    'environment-shell=/bin/zsh',
    'environment-issue=none',
    'environment-codex=missing',
    'environment-pi=missing',
    'environment-gh=missing',
    'environment-node=missing',
  ])
})

test('environment fingerprint changes when rc mtime or shell changes', () => {
  const base = { HOME: '/Users/me', SHELL: '/bin/zsh' }
  const probe = (mtimeMs: number) => () => ({ mtimeMs, path: '/Users/me/.zshrc', size: 10 })
  assert.equal(
    environmentFingerprint(base, 'darwin', probe(100)),
    environmentFingerprint(base, 'darwin', probe(100)),
  )
  assert.notEqual(
    environmentFingerprint(base, 'darwin', probe(100)),
    environmentFingerprint(base, 'darwin', probe(200)),
  )
  assert.notEqual(
    environmentFingerprint(base, 'darwin', probe(100)),
    environmentFingerprint({ ...base, SHELL: '/bin/fish' }, 'darwin', probe(100)),
  )
})

test('cached environment is reused without running the login shell', async () => {
  const base = { HOME: '/Users/me', PATH: '/usr/bin', SHELL: '/bin/zsh' }
  const fingerprint = environmentFingerprint(base, 'darwin')
  const cache: EnvironmentCache = {
    read: () => ({
      createdAt: 1,
      env: { CODEX_HOME: '/cached/.codex', PATH: '/cached/bin', SHELL: '/bin/zsh' },
      fingerprint,
      version: 1,
    }),
    write: () => { throw new Error('cache must not be rewritten on a hit') },
  }
  const result = await resolveUserEnvironment({
    base,
    cache,
    cachePath: '/cache/environment.json',
    platform: 'darwin',
    runLoginShell: async () => { throw new Error('login shell must not run on a cache hit') },
  })
  assert.equal(result.source, 'cached')
  assert.equal(result.env.PATH, '/cached/bin')
  assert.equal(result.env.CODEX_HOME, '/cached/.codex')
})

test('login environment cache is written and invalidated by fingerprint changes', async () => {
  const base = { HOME: '/Users/me', PATH: '/usr/bin', SHELL: '/bin/zsh' }
  const fingerprint = environmentFingerprint(base, 'darwin')
  const output = Buffer.from(
    '__DSH_ENV_BEGIN__\0PATH=/usershell/bin:/usr/bin\0HOME=/Users/me\0__DSH_ENV_END__\0',
  )
  const holder: { record: EnvironmentCacheRecord | null } = { record: null }
  const cache: EnvironmentCache = {
    read: () => holder.record,
    write: (_path, record) => { holder.record = record },
  }

  const first = await resolveUserEnvironment({
    base,
    cache,
    cachePath: '/cache/environment.json',
    loginShell: '/bin/zsh',
    platform: 'darwin',
    runLoginShell: async () => ({ output, status: 0 }),
  })
  assert.equal(first.source, 'login-shell')
  assert.equal(holder.record?.fingerprint, fingerprint)
  assert.equal(holder.record?.env.PATH, '/usershell/bin:/usr/bin')

  const second = await resolveUserEnvironment({
    base,
    cache,
    cachePath: '/cache/environment.json',
    loginShell: '/bin/zsh',
    platform: 'darwin',
    runLoginShell: async () => { throw new Error('cache hit must skip the login shell') },
  })
  assert.equal(second.source, 'cached')

  const changed = await resolveUserEnvironment({
    base: { ...base, SHELL: '/bin/fish' },
    cache,
    cachePath: '/cache/environment.json',
    loginShell: '/bin/zsh',
    platform: 'darwin',
    runLoginShell: async () => ({ output, status: 0 }),
  })
  assert.equal(changed.source, 'login-shell')
})

test('cache escape hatch disables reads and writes', async () => {
  const base = {
    DSH_STUDIO_DISABLE_ENV_CACHE: '1',
    HOME: '/Users/me',
    PATH: '/usr/bin',
    SHELL: '/bin/zsh',
  }
  let reads = 0
  const cache: EnvironmentCache = {
    read: () => { reads += 1; return null },
    write: () => {},
  }
  const result = await resolveUserEnvironment({
    base,
    cache,
    cachePath: '/cache/environment.json',
    loginShell: '/bin/zsh',
    platform: 'darwin',
    runLoginShell: async () => ({
      output: Buffer.from('__DSH_ENV_BEGIN__\0PATH=/p:/usr/bin\0HOME=/Users/me\0__DSH_ENV_END__\0'),
      status: 0,
    }),
  })
  assert.equal(result.source, 'login-shell')
  assert.equal(reads, 0)
})

test('disk cache excludes session transport variables', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-studio-env-cache-'))
  try {
    const path = join(root, 'environment-cache.json')
    defaultEnvironmentCache.write(path, {
      createdAt: 1,
      env: {
        PATH: '/usr/bin',
        SHELL: '/bin/zsh',
        SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
        DISPLAY: ':0',
      },
      fingerprint: 'fp',
      version: 1,
    })
    const record = defaultEnvironmentCache.read(path)
    assert.equal(record?.env.PATH, '/usr/bin')
    assert.equal(record?.env.SSH_AUTH_SOCK, undefined)
    assert.equal(record?.env.DISPLAY, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
