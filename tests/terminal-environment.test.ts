import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createTerminalSpawnEnvironment,
  mergeTerminalSpawnEnvironment,
} from '../plugins/sidebar-host/src/terminal-environment.ts'
import {
  isRetryableShellSpawnError,
  resolveShellCandidates,
} from '../plugins/sidebar-host/src/shell-resolver.ts'

test('embedded terminal environment removes parent emulator capabilities', () => {
  const result = createTerminalSpawnEnvironment({
    PATH: '/bin',
    TERM: 'xterm-kitty',
    COLORTERM: '24bit',
    TERMINFO: '/tmp/terminfo',
    KITTY_WINDOW_ID: '1',
    GHOSTTY_RESOURCES_DIR: '/tmp/ghostty',
    ITERM_SESSION_ID: 'session',
    WEZTERM_PANE: 'pane',
  })
  assert.equal(result.env.TERM, 'xterm-256color')
  assert.equal(result.env.COLORTERM, 'truecolor')
  assert.equal(result.env.TERM_PROGRAM, 'oh-dsh')
  assert.equal(result.env.TERMINFO, undefined)
  assert.equal(result.env.KITTY_WINDOW_ID, undefined)
  assert.equal(result.env.GHOSTTY_RESOURCES_DIR, undefined)
  assert.equal(result.env.ITERM_SESSION_ID, undefined)
  assert.equal(result.env.WEZTERM_PANE, undefined)
  assert.deepEqual(result.profile.removedKeys.sort(), [
    'COLORTERM',
    'GHOSTTY_RESOURCES_DIR',
    'ITERM_SESSION_ID',
    'KITTY_WINDOW_ID',
    'TERMINFO',
    'WEZTERM_PANE',
  ])
})

test('environment overrides cannot reintroduce a parent terminal identity', () => {
  const result = mergeTerminalSpawnEnvironment(
    { TERM: 'xterm', PATH: '/bin' },
    { TERM: 'screen', TERMINFO: '/tmp/injected', COLORTERM: 'ansi' },
  )
  assert.equal(result.env.TERM, 'xterm-256color')
  assert.equal(result.env.COLORTERM, 'truecolor')
  assert.equal(result.env.TERMINFO, undefined)
})

test('shell candidates retain the configured primary and provide platform fallbacks', () => {
  assert.deepEqual(
    resolveShellCandidates({
      platform: 'linux',
      explicit: '/missing/custom-shell',
      env: { SHELL: '/bin/zsh' },
      loginShell: '/bin/fish',
    }),
    ['/missing/custom-shell', '/bin/zsh', '/bin/fish', '/bin/bash', '/bin/sh'],
  )
  assert.equal(isRetryableShellSpawnError({ code: 'ENOENT' }), true)
  assert.equal(isRetryableShellSpawnError(new Error('permission denied')), false)
})
