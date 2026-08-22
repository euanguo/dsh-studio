import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('terminal theme follows appearance flips by watching the body attribute', () => {
  const owner = readFileSync(
    join(root, 'plugins/shared/terminal-runtime-owner.ts'),
    'utf8',
  )
  const theme = readFileSync(
    join(root, 'plugins/shared/terminal-theme.ts'),
    'utf8',
  )
  // The runtime toggles data-ds-dark-theme on <body>; observing <html> never
  // fires, leaving a stale canvas theme after a light/dark switch.
  assert.match(owner, /observe\(document\.body, \{[\s\S]*attributeFilter: \['data-ds-dark-theme'\]/)
  assert.doesNotMatch(owner, /observe\(document\.documentElement/)
  // Theme writes are value-gated: a no-op write would rebuild xterm's palette
  // and discard TUI OSC color mutations.
  assert.match(owner, /appliedThemeKey/)
})
