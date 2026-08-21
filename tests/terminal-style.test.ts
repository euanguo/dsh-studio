import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('terminal viewport cannot expose xterm default black behind the themed screen', () => {
  const css = readFileSync(join(root, 'plugins/panel-controls/src/terminal/terminal.css'), 'utf8')
  assert.match(css, /\.dsh-studio-terminal-view \.xterm-viewport[\s\S]*background-color:[^;]+!important/)
  // The xterm canvas needs a solid backdrop that follows its host surface:
  // the rail panels bridge `--dsh-studio-terminal-backdrop` to the rail fill
  // while the root default keeps the layered base token for center surfaces.
  assert.match(css, /\.dsh-studio-terminal-view \.xterm-viewport[\s\S]*var\(--dsh-studio-terminal-backdrop/)
  // The host stays zero-padding (padding on the host would sit OUTSIDE
  // xterm's fit measurement and desync the grid); breathing room lives on
  // `.xterm` itself as a uniform 8px inset that FitAddon genuinely
  // subtracts, so the right edge is no longer the only gapped side.
  assert.doesNotMatch(css, /\.dsh-studio-terminal-view \{[^}]*padding:/)
  assert.match(css, /\.dsh-studio-terminal-view \.xterm \{[^}]*padding: var\(--dsh-studio-space-2\);/)
  assert.match(css, /\.dsh-studio-terminal-view \.xterm \{[^}]*box-sizing: border-box;/)
})

test('terminal scrollbar is a rounded DOM slider, not the native square one', () => {
  const shared = readFileSync(join(root, 'plugins/shared/terminal-view.css'), 'utf8')
  assert.match(
    shared,
    /\.dsh-studio-terminal-view \.xterm \.xterm-scrollable-element > \.xterm-scrollbar > \.xterm-slider \{[\s\S]*border-radius: 4px;/,
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
  assert.doesNotMatch(css, /dsh-studio-terminal-trigger/)
})

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
  // The screen canvas resolves from the terminal's own container so the
  // bridge variable follows the host surface (rail fill vs center base).
  assert.match(theme, /resolveTerminalTheme\(source: Element = document\.body\)/)
})
