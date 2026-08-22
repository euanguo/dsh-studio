import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildLaunchCommand } from '../src/runtime.ts'

const BASE = {
  args: ['--profile', 'dsh-desktop'],
  cliEntry: '/app/Resources/dsh-runtime/lib/bin.js',
  cwd: '/workspace',
  env: { DSH_STUDIO_DESKTOP: '1' },
  nodeBinary: '/app/Resources/node-runtime/bin/node',
}

test('buildLaunchCommand: plain nodeBinary (Web/TUI distribution)', () => {
  const launch = buildLaunchCommand(BASE)
  assert.equal(launch.command, '/app/Resources/node-runtime/bin/node')
  assert.deepEqual(launch.args, ['/app/Resources/dsh-runtime/lib/bin.js', '--profile', 'dsh-desktop'])
  assert.equal(launch.env.DSH_STUDIO_DESKTOP, '1')
})

test('buildLaunchCommand: node flags precede the CLI entry in every shape', () => {
  const withFlags = { ...BASE, nodeFlags: ['--expose-internals'] }
  const plain = buildLaunchCommand(withFlags)
  assert.deepEqual(plain.args, ['--expose-internals', '/app/Resources/dsh-runtime/lib/bin.js', '--profile', 'dsh-desktop'])

  const interpreter = buildLaunchCommand({
    ...withFlags,
    launcher: { command: '/app/Contents/MacOS/DSH Studio', env: { ELECTRON_RUN_AS_NODE: '1' }, interpreter: true },
  })
  assert.deepEqual(interpreter.args, ['--expose-internals', '/app/Resources/dsh-runtime/lib/bin.js', '--profile', 'dsh-desktop'])

  const wrapped = buildLaunchCommand({
    ...withFlags,
    launcher: {
      command: '/usr/bin/sandbox-exec',
      args: ['-p', 'policy'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      interpreter: true,
      interpreterCommand: '/app/Contents/MacOS/DSH Studio',
    },
  })
  assert.deepEqual(wrapped.args, [
    '-p', 'policy',
    '/app/Contents/MacOS/DSH Studio',
    '--expose-internals',
    '/app/Resources/dsh-runtime/lib/bin.js',
    '--profile', 'dsh-desktop',
  ])
})

test('buildLaunchCommand: interpreter launcher (Electron as Node)', () => {
  const launch = buildLaunchCommand({
    ...BASE,
    launcher: {
      command: '/app/Contents/MacOS/DSH Studio',
      env: { ELECTRON_RUN_AS_NODE: '1' },
      interpreter: true,
    },
  })
  assert.equal(launch.command, '/app/Contents/MacOS/DSH Studio')
  // The standalone node binary is never passed as an argument.
  assert.deepEqual(launch.args, ['/app/Resources/dsh-runtime/lib/bin.js', '--profile', 'dsh-desktop'])
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(launch.env.DSH_STUDIO_DESKTOP, '1')
})

test('buildLaunchCommand: wrapped interpreter (sandbox-exec around Electron)', () => {
  const launch = buildLaunchCommand({
    ...BASE,
    launcher: {
      command: '/usr/bin/sandbox-exec',
      args: ['-p', 'policy'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      interpreter: true,
      interpreterCommand: '/app/Contents/MacOS/DSH Studio',
    },
  })
  assert.equal(launch.command, '/usr/bin/sandbox-exec')
  assert.deepEqual(launch.args, [
    '-p',
    'policy',
    '/app/Contents/MacOS/DSH Studio',
    '/app/Resources/dsh-runtime/lib/bin.js',
    '--profile',
    'dsh-desktop',
  ])
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, '1')
})

test('buildLaunchCommand: wrapper launcher (nodeBinary appended)', () => {
  const launch = buildLaunchCommand({
    ...BASE,
    launcher: { command: '/usr/bin/env', args: ['-i'] },
  })
  assert.equal(launch.command, '/usr/bin/env')
  assert.deepEqual(launch.args, [
    '-i',
    '/app/Resources/node-runtime/bin/node',
    '/app/Resources/dsh-runtime/lib/bin.js',
    '--profile',
    'dsh-desktop',
  ])
})
