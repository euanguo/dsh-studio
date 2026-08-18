import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('terminal viewport cannot expose xterm default black behind the themed screen', () => {
  const css = readFileSync(join(root, 'plugins/panel-controls/src/terminal/terminal.css'), 'utf8')
  assert.match(css, /\.oh-dsh-terminal-view \.xterm-viewport[\s\S]*background-color:[^;]+!important/)
  // The host stays zero-padding (padding on the host would sit OUTSIDE
  // xterm's fit measurement and desync the grid); breathing room lives on
  // `.xterm` itself as a uniform 8px inset that FitAddon genuinely
  // subtracts, so the right edge is no longer the only gapped side.
  assert.doesNotMatch(css, /\.oh-dsh-terminal-view \{[^}]*padding:/)
  assert.match(css, /\.oh-dsh-terminal-view \.xterm \{[^}]*padding: var\(--oh-dsh-space-2\);/)
  assert.match(css, /\.oh-dsh-terminal-view \.xterm \{[^}]*box-sizing: border-box;/)
})

test('terminal scrollbar is a rounded DOM slider, not the native square one', () => {
  const shared = readFileSync(join(root, 'plugins/shared/terminal-view.css'), 'utf8')
  assert.match(
    shared,
    /\.oh-dsh-terminal-view \.xterm \.xterm-scrollable-element > \.xterm-scrollbar > \.xterm-slider \{[\s\S]*border-radius: 4px;/,
  )
  const dock = readFileSync(join(root, 'plugins/panel-controls/src/terminal/terminal.css'), 'utf8')
  assert.match(dock, /\.xterm-slider \{[^}]*border-radius: 4px;/)
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
