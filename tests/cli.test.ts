import assert from 'node:assert/strict'
import { posix } from 'node:path'
import { test } from 'node:test'
import {
  desktopLaunchSpec,
  main,
} from '../src/cli.ts'

function output(): { stream: NodeJS.WriteStream; text: () => string } {
  let value = ''
  return {
    stream: {
      isTTY: false,
      write: (chunk: string) => {
        value += chunk
        return true
      },
    } as unknown as NodeJS.WriteStream,
    text: () => value,
  }
}

test('dsh-studio dispatches desktop aliases, web, and TUI through one surface command', async () => {
  const stdout = output()
  const stderr = output()
  const calls: Array<{ args: readonly string[]; surface: string }> = []

  assert.equal(await main(
    ['desktop', '--inspect'],
    {},
    stdout.stream,
    stderr.stream,
    async args => {
      calls.push({ args, surface: 'desktop' })
      return 0
    },
    async args => {
      calls.push({ args, surface: 'web' })
      return 0
    },
  ), 0)
  assert.equal(await main(
    ['gui', '--inspect'],
    {},
    stdout.stream,
    stderr.stream,
    async args => {
      calls.push({ args, surface: 'desktop' })
      return 0
    },
    async () => 0,
  ), 0)
  assert.equal(await main(
    ['web', '--port', '0'],
    {},
    stdout.stream,
    stderr.stream,
    async () => 0,
    async args => {
      calls.push({ args, surface: 'web' })
      return 0
    },
  ), 0)
  assert.equal(await main(
    ['tui', '--inline'],
    {},
    stdout.stream,
    stderr.stream,
    async () => 0,
    async () => 0,
    async args => {
      calls.push({ args, surface: 'tui' })
      return 0
    },
  ), 0)
  assert.deepEqual(calls, [
    { args: ['--inspect'], surface: 'desktop' },
    { args: ['--inspect'], surface: 'desktop' },
    { args: ['--port', '0'], surface: 'web' },
    { args: ['--inline'], surface: 'tui' },
  ])
})

test('layered distributions list and reject unavailable surfaces', async () => {
  const stdout = output()
  const stderr = output()
  assert.equal(await main(
    ['--help'],
    { DSH_STUDIO_SURFACES: 'web' },
    stdout.stream,
    stderr.stream,
  ), 0)
  assert.match(stdout.text(), /web\s+Start DSH Studio Web/)
  assert.doesNotMatch(stdout.text(), /desktop\s+Start/)
  assert.doesNotMatch(stdout.text(), /tui\s+Start/)

  assert.equal(await main(
    ['desktop'],
    { DSH_STUDIO_SURFACES: 'web' },
    stdout.stream,
    stderr.stream,
  ), 2)
  assert.match(stderr.text(), /Surface 'desktop' is not included/)
  assert.equal(await main(
    ['gui'],
    { DSH_STUDIO_SURFACES: 'web' },
    stdout.stream,
    stderr.stream,
  ), 2)
  assert.match(stderr.text(), /Surface 'gui' is not included/)
})

test('desktop launch accepts a channel and help without starting Electron', async () => {
  const stdout = output()
  const stderr = output()
  const calls: Array<{ args: readonly string[]; channel?: string }> = []
  assert.equal(await main(
    ['desktop', '--help'],
    {},
    stdout.stream,
    stderr.stream,
    async () => {
      calls.push({ args: ['should-not-run'] })
      return 1
    },
  ), 0)
  assert.match(stdout.text(), /--channel/)
  assert.equal(await main(
    ['desktop', '--channel', 'dev', '--inspect'],
    {},
    stdout.stream,
    stderr.stream,
    async (args, env) => {
      calls.push({ args, ...(env.DSH_STUDIO_CHANNEL === undefined ? {} : { channel: env.DSH_STUDIO_CHANNEL }) })
      return 0
    },
  ), 0)
  assert.deepEqual(calls, [{ args: ['--inspect'], channel: 'dev' }])
})

test('desktop launch keeps source and installed macOS paths distinct', () => {
  assert.deepEqual(desktopLaunchSpec([], {
    DSH_STUDIO_DESKTOP_APP: '/Applications/DSH Studio.app',
  }, 'darwin'), {
    args: ['/Applications/DSH Studio.app'],
    command: '/usr/bin/open',
  })
  assert.deepEqual(desktopLaunchSpec([], {}, 'darwin'), {
    args: ['-a', 'DSH Studio'],
    command: '/usr/bin/open',
  })
})

test('macOS installed launches inherit the shared DSH Studio state root', () => {
  assert.deepEqual(desktopLaunchSpec([], {
    DSH_STUDIO_HOME: '/data/dsh-studio',
  }, 'darwin'), {
    args: ['--env', 'DSH_STUDIO_HOME=/data/dsh-studio', '-a', 'DSH Studio'],
    command: '/usr/bin/open',
  })
  assert.deepEqual(desktopLaunchSpec(['--inspect'], {
    DSH_STUDIO_DESKTOP_APP: '/Applications/DSH Studio.app',
    DSH_STUDIO_HOME: '/data/dsh-studio',
  }, 'darwin'), {
    args: [
      '--env',
      'DSH_STUDIO_HOME=/data/dsh-studio',
      '/Applications/DSH Studio.app',
      '--args',
      '--inspect',
    ],
    command: '/usr/bin/open',
  })
  assert.deepEqual(desktopLaunchSpec([], {
    DSH_STUDIO_HOME: './relative-state',
  }, 'darwin'), {
    args: [
      '--env',
      `DSH_STUDIO_HOME=${posix.resolve('./relative-state')}`,
      '-a',
      'DSH Studio',
    ],
    command: '/usr/bin/open',
  })
  assert.deepEqual(desktopLaunchSpec([], {
    DSH_STUDIO_CHANNEL: 'dev',
    DSH_STUDIO_HOME: '/data/dsh-studio-dev',
  }, 'darwin'), {
    args: [
      '--env',
      'DSH_STUDIO_HOME=/data/dsh-studio-dev',
      '--env',
      'DSH_STUDIO_CHANNEL=dev',
      '-a',
      'DSH Studio',
    ],
    command: '/usr/bin/open',
  })
})

test('desktop launch resolves paths with target platform semantics', () => {
  assert.deepEqual(desktopLaunchSpec(['--inspect'], {
    DSH_STUDIO_DESKTOP_APP: 'C:\\Tools\\DSH Studio.exe',
  }, 'win32'), {
    args: ['--inspect'],
    command: 'C:\\Tools\\DSH Studio.exe',
  })
})
