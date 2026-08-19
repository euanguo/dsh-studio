import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('desktop sidebar is a fixed overlay that never restructures #root', () => {
  const css = readFileSync(
    join(root, 'plugins/sidebar/src/client/sidebar.css'),
    'utf8',
  )
  const workspace = readFileSync(
    join(root, 'plugins/sidebar/src/client/workspace-tools.tsx'),
    'utf8',
  )

  // No grid wrapper: the sidebar overlays the app, #root stays in place.
  assert.doesNotMatch(css, /#dsh-studio-embedded-layout/)
  assert.match(css, /#dsh-studio-sidebar-root\s*\{[^}]*position: fixed;[^}]*z-index: 10;[^}]*pointer-events: none;/s)
  assert.doesNotMatch(workspace, /appRoot\.before\(layout\)/)
  assert.match(workspace, /document\.body\.append\(this\.element\)/)

  // The squeeze is claimed through the desktopPanels coordinator.
  assert.match(workspace, /this\.panels\.claimRightPanel\('sidebar'/)
  assert.match(workspace, /this\.panels\.releaseRightPanel\('sidebar'/)
  assert.doesNotMatch(workspace, /dshStudioRightPanelOwner = /)
})

test('right panel footprint is coordinated by the desktopPanels service', () => {
  const panels = readFileSync(
    join(root, 'plugins/panel-controls/src/terminal/plugin.tsx'),
    'utf8',
  )
  const summary = readFileSync(join(root, 'plugins/pinned-summary/src/client.ts'), 'utf8')

  assert.match(panels, /claimRightPanel\(ownerId: string, claim: RightPanelClaim\)/)
  assert.match(panels, /releaseRightPanel\(ownerId: string\)/)
  assert.match(panels, /html\.dataset\.dshStudioRightPanelOwner = ownerId/)
  assert.match(panels, /appRoot\?\.style\.setProperty\('padding-right', claim\.paddingRight\)/)
  // Plugins must not write the owner flag or #root padding themselves.
  assert.doesNotMatch(summary, /dshStudioRightPanelOwner = /)
  assert.doesNotMatch(summary, /getElementById\('root'\)\?\.style\.removeProperty\('padding-right'\)/)
})

test('review, pinned summary, and embedded side tools keep distinct layouts', () => {
  const summary = readFileSync(join(root, 'plugins/pinned-summary/src/client.ts'), 'utf8')
  const workspace = readFileSync(join(root, 'plugins/sidebar/src/client/workspace-tools.tsx'), 'utf8')
  const plugin = readFileSync(join(root, 'plugins/sidebar/src/client/plugin.tsx'), 'utf8')
  const builtinTabs = readFileSync(join(root, 'plugins/sidebar/src/client/builtins/tabs.tsx'), 'utf8')
  const builtinViewers = readFileSync(join(root, 'plugins/sidebar/src/client/builtins/viewers.tsx'), 'utf8')
  const workspacePanel = readFileSync(join(root, 'plugins/sidebar/src/client/workspace-panel.tsx'), 'utf8')
  const workspaceCss = readFileSync(join(root, 'plugins/sidebar/src/client/sidebar.css'), 'utf8')
  const sideTools = readFileSync(join(root, 'plugins/sidebar/src/client/SideToolsPanel.tsx'), 'utf8')
  const sideToolsCss = readFileSync(join(root, 'plugins/sidebar/src/client/side-tools.css'), 'utf8')

  assert.match(workspace, /if \(open\) this\.pinnedSummary\.setOpen\(false\)/)
  assert.match(workspace, /if \(this\.state\.open\) this\.pinnedSummary\.setOpen\(false\)/)
  assert.match(summary, /this\.#panels\.claimRightPanel\('pinned-summary'/)
  assert.match(summary, /calc\(var\(--dsh-studio-pinned-summary-width\) \+ 24px\)/)
  assert.match(summary, /height: calc\(\(100vh - var\(--dsh-studio-titlebar-height, 40px\) - 24px\) \/ 2\);/)
  assert.doesNotMatch(summary, /height: min\(360px/)
  assert.doesNotMatch(workspace, /aria-label="Toggle review panel"/)
  assert.match(workspacePanel, /className="dsh-studio-review-view"/)
  assert.doesNotMatch(workspacePanel, /dsh-studio-review-panel/)
  assert.doesNotMatch(workspacePanel, /const embeddedWidth/)
  assert.match(workspace, /const fullWidth = this\.state\.maximized \|\| this\.narrowViewport\.matches/)
  assert.match(workspace, /this\.element\.style\.width = this\.state\.open/)
  assert.match(workspaceCss, /\.dsh-studio-review-view\s*\{[^}]*display: flex;[^}]*flex: 1;[^}]*flex-direction: column;/s)
  assert.match(sideTools, /props\.sidebar\.getTabs\(\)/)
  assert.match(sideTools, /props\.sidebar\.getTab\(activeTab\.type\)/)
  assert.match(sideTools, /descriptor\.render\(renderProps\)/)
  assert.match(sideTools, /<TabStrip sidebar=\{props\.sidebar\} t=\{props\.t\} \/>/)
  // Built-in registrations are dogfooded through the same registry service
  // (builtins/ modules); the plugin assembly only wires the services in.
  assert.match(plugin, /registerBuiltins\(desktopSidebar/)
  assert.match(builtinTabs, /id: 'review'/)
  assert.match(builtinTabs, /id: 'files'/)
  assert.match(builtinViewers, /id: 'binary'/)
  assert.match(plugin, /desktopSidebar\.setWorkspace\(/)
  assert.match(sideToolsCss, /\.dsh-studio-side-panel\s*\{[^}]*width: 100% !important;[^}]*border-radius: 0;[^}]*box-shadow: none;/s)
  // The window controls live in the panel's top row, flush right — no
  // floating toolbar, no summary button riding the window edge.
  assert.doesNotMatch(workspace, /DesktopPanelToolbar/)
  assert.doesNotMatch(workspace, /kind === 'summary'/)
  assert.match(sideTools, /function PanelActions/)
  assert.match(sideTools, /className="dsh-studio-side-tabs-actions"/)
  assert.match(sideTools, /aria-pressed=\{open\}/)
  assert.match(sideTools, /onToggleSide=\{props\.onToggleSide\}/)
  assert.match(sideToolsCss, /\.dsh-studio-side-tabs-actions\s*\{[^}]*margin-left: auto;/s)
  assert.doesNotMatch(sideToolsCss, /\.dsh-studio-side-tabs-actions\s*\{[^}]*position: fixed;/s)
  assert.doesNotMatch(sideToolsCss, /\.dsh-studio-side-tabs-actions\s*\{[^}]*box-shadow:/s)
  assert.match(workspaceCss, /\.dsh-studio-workspace-panel\[data-open='true'\]/)
  assert.match(summary, /\[data-dsh-studio-pinned-summary\]\[data-open='true'\]/)
})
