import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cn } from '../plugins/shared/ui/cn.ts'

const root = join(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

test('shadcn package config targets the existing DSH theme and shared UI seam', () => {
  const config = JSON.parse(read('plugins/shared/components.json')) as {
    tailwind: { css: string }
    aliases: { ui: string; utils: string }
    iconLibrary: string
  }
  assert.equal(config.tailwind.css, 'theme.css')
  assert.equal(config.aliases.ui, 'ui')
  assert.equal(config.aliases.utils, 'ui/cn')
  assert.equal(config.iconLibrary, 'tabler')

  const packageJson = JSON.parse(read('plugins/shared/package.json')) as {
    exports: Record<string, string>
  }
  assert.equal(packageJson.exports['./ui'], './ui/index.ts')
  assert.equal(packageJson.exports['./ui/card'], './ui/card.tsx')
  assert.equal(packageJson.exports['./ui/feedback-state'], './ui/feedback-state.tsx')
  assert.equal(packageJson.exports['./ui/settings-row'], './ui/settings-row.tsx')
  assert.equal(packageJson.exports['./ui/settings-section'], './ui/settings-section.tsx')
  assert.equal(packageJson.exports['./ui/slider'], './ui/slider.tsx')
  assert.equal(packageJson.exports['./ui/switch'], './ui/switch.tsx')
  assert.equal(packageJson.exports['./ui/textarea'], './ui/textarea.tsx')
  assert.equal(packageJson.exports['./ui/status-line'], './ui/status-line.tsx')
  assert.equal(packageJson.exports['./ui/toolbar-action'], './ui/toolbar-action.tsx')
  assert.equal(packageJson.exports['./ui-styles'], './ui/styles.ts')
  assert.equal(packageJson.exports['./ui.css'], './ui/ui.css')
})

test('shared UI semantic variables resolve through DSW aliases', () => {
  const theme = read('plugins/shared/theme.css')
  for (const token of [
    '--dsh-studio-ui-background',
    '--dsh-studio-ui-foreground',
    '--dsh-studio-ui-card',
    '--dsh-studio-ui-muted',
    '--dsh-studio-ui-border',
    '--dsh-studio-ui-primary',
    '--dsh-studio-ui-destructive',
  ]) {
    assert.match(theme, new RegExp(`${token}:\\s*var\\(--dsw-`))
  }
  assert.match(read('plugins/shared/ui/ui.css'), /--dsh-studio-ui-card/)
  assert.match(read('plugins/shared/ui/ui.css'), /dsh-studio-ui-settings-row-copy[\s\S]*--dsw-alias-label-primary/)
  assert.match(read('plugins/shared/ui/ui.css'), /dsh-studio-ui-switch[\s\S]*--dsw-alias-brand-primary/)
})

test('shared UI source layer avoids duplicate official atoms and styling runtimes', () => {
  const sources = [
    read('plugins/shared/ui/card.tsx'),
    read('plugins/shared/ui/field.tsx'),
    read('plugins/shared/ui/separator.tsx'),
    read('plugins/shared/ui/alert.tsx'),
    read('plugins/shared/ui/empty.tsx'),
    read('plugins/shared/ui/skeleton.tsx'),
    read('plugins/shared/ui/slider.tsx'),
    read('plugins/shared/ui/switch.tsx'),
    read('plugins/shared/ui/textarea.tsx'),
  ].join('\n')
  assert.doesNotMatch(sources, /@deepseek-ai\/dsh-client-ui-primitives/)
  assert.doesNotMatch(sources, /radix-ui|lucide-react|tailwindcss/)
})

test('plugin shared composites keep official chrome ownership explicit', () => {
  const settingsRow = read('plugins/shared/ui/settings-row.tsx')
  const toolbarAction = read('plugins/shared/ui/toolbar-action.tsx')
  const statusLine = read('plugins/shared/ui/status-line.tsx')
  const feedbackState = read('plugins/shared/ui/feedback-state.tsx')

  assert.match(settingsRow, /control: ReactNode/)
  assert.match(settingsRow, /dsh-studio-ui-settings-row/)
  const settingsSwitch = read('plugins/shared/ui/switch.tsx')
  assert.match(settingsRow, /aria-labelledby=/)
  assert.match(settingsSwitch, /@base-ui\/react\/switch/)
  assert.match(settingsSwitch, /SwitchPrimitive\.Root/)
  assert.match(settingsSwitch, /SwitchPrimitive\.Thumb/)
  assert.match(settingsSwitch, /data-size={size}/)
  assert.match(toolbarAction, /Button[\s\S]*variant="toolbar"/)
  assert.match(toolbarAction, /toolbar-action-anchor/)
  assert.match(toolbarAction, /data-slot="toolbar-action"/)
  assert.match(toolbarAction, /Tooltip/)
  assert.match(toolbarAction, /tooltipSide = 'bottom'/)
  assert.match(toolbarAction, /side=\{tooltipSide\}/)
  assert.doesNotMatch(statusLine, /@deepseek-ai\/dsh-client-ui-primitives/)
  assert.doesNotMatch(feedbackState, /@deepseek-ai\/dsh-client-ui-primitives/)
  assert.match(feedbackState, /data-layout={layout}/)
  assert.match(feedbackState, /EmptyState|LoadingState|ErrorState/)
  assert.match(read('plugins/shared/ui/styles.ts'), /ensureSharedUiStyles\(id: string\)/)
})

test('migrated plugin surfaces consume the shared settings and feedback seams', () => {
  assert.match(read('plugins/desktop-skins/src/client/plugin.tsx'), /SettingsRow/)
  assert.match(read('plugins/desktop-left-rail/src/client/WorktreeSettingsSection.tsx'), /SettingsSection/)
  assert.match(read('plugins/panel-controls/src/terminal/TerminalPanel.tsx'), /ToolbarAction/)
  assert.match(read('plugins/sidebar/src/client/source-control/source-control-ai-settings.tsx'), /SettingsRow/)
  const sidebarSettings = read('plugins/sidebar/src/client/settings.tsx')
  assert.match(sidebarSettings, /const description = meta === '' \? undefined : meta/)
  assert.doesNotMatch(sidebarSettings, /const detail = meta === '' \? id/)
  assert.doesNotMatch(sidebarSettings, /type="checkbox"/)
  assert.match(sidebarSettings, /<Switch/)
  assert.match(read('plugins/sidebar/src/client/source-control/source-control-ai-settings.tsx'), /<Switch/)
  assert.match(read('plugins/sidebar/src/client/source-control/source-control-ai-settings.tsx'), /<Textarea/)
  assert.match(read('plugins/sidebar/src/client/source-control/source-control-ai-settings.tsx'), /disabled={saving}/)
  assert.match(read('plugins/sidebar/src/client/settings.tsx'), /<Slider/)
  assert.doesNotMatch(read('plugins/sidebar/src/client/settings.tsx'), /type="range"/)
  assert.match(read('plugins/desktop-left-rail/src/client/WorktreeSettingsSection.tsx'), /<Switch/)
  assert.match(read('plugins/plugin-marketplace/src/client/plugin.tsx'), /AlertAction/)
  assert.doesNotMatch(read('plugins/desktop-skins/src/client/plugin.tsx'), /skins-tile|skins-grid/)
  // Column semantics: settings-row sections (侧边栏 / Agent 访问 / 提交代码 AI)
  // stack in one column; only the compact feature cards (工具 / 文件预览)
  // keep the fixed two-column grid.
  assert.match(read('plugins/sidebar/src/client/side-tools.css'), /dsh-studio-sidebar-settings-rows[\s\S]*grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(read('plugins/sidebar/src/client/side-tools.css'), /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.doesNotMatch(read('plugins/sidebar/src/client/side-tools.css'), /@media \(max-width: 760px\)/)
  const gridCardUses = sidebarSettings.match(/dsh-studio-sidebar-settings-grid/g)?.length ?? 0
  assert.equal(gridCardUses, 2)
  const rowSectionUses = sidebarSettings.match(/dsh-studio-sidebar-settings-rows/g)?.length ?? 0
  assert.equal(rowSectionUses, 3)
  assert.match(read('plugins/sidebar/src/client/source-control/source-control-ai-settings.tsx'), /dsh-studio-sidebar-settings-rows/)
  assert.doesNotMatch(read('plugins/sidebar/src/client/sidebar.css'), /settings-ai .*grid-template-columns/)
})

test('shared UI preserves compact status and source-control action geometry', () => {
  const sharedCss = read('plugins/shared/ui/ui.css')
  const sourceControlCss = read('plugins/sidebar/src/client/source-control/source-control.css')
  const sideToolsCss = read('plugins/sidebar/src/client/side-tools.css')

  assert.match(sharedCss, /data-layout='compact'[\s\S]*--dsw-alias-label-secondary/)
  assert.match(sourceControlCss, /dsh-studio-sc-toolbar-mode[\s\S]*width: var\(--dsh-studio-control-sm\)/)
  // Rail surface ownership: side-tools.css holds the fill and both bridges
  // for every rail root; inner strips (history) and shared terminal chrome
  // follow the surface instead of repainting their own base tokens.
  assert.match(sideToolsCss, /\.dsh-studio-workspace-panel[\s\S]*background: var\(--dsw-specific-sidebar-fill/)
  assert.match(sideToolsCss, /\[data-dsh-studio-layout-frame\] > :nth-child\(3\)/)
  assert.match(sideToolsCss, /--dsh-studio-terminal-backdrop: var\(--dsw-specific-sidebar-fill/)
  const terminalCss = read('plugins/panel-controls/src/terminal/terminal.css')
  const terminalSharedCss = read('plugins/shared/terminal-view.css')
  const terminalTheme = read('plugins/shared/terminal-theme.ts')
  const themeCss = read('plugins/shared/theme.css')
  assert.doesNotMatch(terminalCss, /\.dsh-studio-terminal-dock\s*\{[^}]*background: var\(--dsw-alias-bg/s)
  assert.match(terminalSharedCss, /--dsh-studio-terminal-backdrop/)
  assert.match(terminalTheme, /'--dsh-studio-terminal-backdrop'/)
  // The root bridge default must live on body, not :root — DSW alias tokens
  // are body-scoped, so a :root var() reference can never substitute them.
  assert.match(themeCss, /body \{\s*\n\s*--dsh-studio-terminal-backdrop: var\(--dsw-alias-bg-layer-1/)
  // No :root copy: the bridge must not appear inside the :root block at all.
  assert.doesNotMatch(themeCss.slice(themeCss.indexOf(':root'), themeCss.indexOf('}', themeCss.indexOf('--dsh-studio-tone-protected-fg'))), /--dsh-studio-terminal-backdrop/)
})

test('cn composes conditional classes without a runtime dependency', () => {
  assert.equal(cn('base', false, ['nested', { active: true, hidden: false }]), 'base nested active')
})

test('legacy shared component paths delegate to the canonical UI source layer', () => {
  assert.match(read('plugins/shared/list-row.tsx'), /from '\.\/ui\/list-row\.tsx'/)
  assert.match(read('plugins/shared/surface-tab.tsx'), /from '\.\/ui\/surface-tab\.tsx'/)
  assert.match(read('plugins/shared/scrollable.tsx'), /from '\.\/ui\/scrollable\.tsx'/)
})
