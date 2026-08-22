import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  findUserExecutable,
  parseLoginShellEnvironment,
  resolveUserEnvironment,
  userEnvironmentDiagnostics,
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
  ])
})
