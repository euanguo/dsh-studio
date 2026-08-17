import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('terminal viewport cannot expose xterm default black behind the themed screen', () => {
  const css = readFileSync(join(root, 'plugins/panel-controls/src/terminal/terminal.css'), 'utf8')
  assert.match(css, /\.oh-dsh-terminal-view \.xterm-viewport[\s\S]*background-color:[^;]+!important/)
  // The viewport stays padded with theme tokens (never 0 — xterm black must
  // not show through), and .xterm itself must not get its own padding.
  assert.match(css, /\.oh-dsh-terminal-view \{[\s\S]*padding: var\(--oh-dsh-space-2\) var\(--oh-dsh-space-3\);/)
  assert.doesNotMatch(css, /\.oh-dsh-terminal-view \.xterm \{[^}]*padding:/)
})

test('terminal is controlled only by the shared desktop toolbar', () => {
  const plugin = readFileSync(
    join(root, 'plugins/panel-controls/src/terminal/plugin.tsx'),
    'utf8',
  )
  const mounts = readFileSync(
    join(root, 'plugins/shared/column-mount.ts'),
    'utf8',
  )
  const css = readFileSync(
    join(root, 'plugins/panel-controls/src/terminal/terminal.css'),
    'utf8',
  )

  assert.doesNotMatch(plugin, /TerminalTrigger|terminal-trigger-root/)
  assert.doesNotMatch(mounts, /terminal-trigger-root/)
  assert.doesNotMatch(css, /oh-dsh-terminal-trigger/)
})
