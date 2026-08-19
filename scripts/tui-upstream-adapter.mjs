import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TUI_PRODUCT_NAME = 'DSH Studio TUI'

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8')
  if (source.includes(after)) return
  const first = source.indexOf(before)
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`TUI upstream adapter seam changed: ${path}`)
  }
  writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length))
}

function replaceEvery(path, before, after) {
  const source = readFileSync(path, 'utf8')
  if (!source.includes(before)) {
    if (source.includes(after)) return
    throw new Error(`TUI upstream adapter seam changed: ${path}`)
  }
  writeFileSync(path, source.split(before).join(after))
}

function scopePreferenceFile(lib, name, declaration = 'PREFS_DIR') {
  replaceOnce(
    join(lib, name),
    `const ${declaration} = join(homedir(), '.dsh-cc');`,
    `const ${declaration} = process.env.DSH_STUDIO_TUI_CONFIG_HOME ?? join(homedir(), '.dsh-studio', 'tui');`,
  )
}

/**
 * Apply the deliberately small DSH Studio adapter to a copied upstream package.
 * The submodule remains pristine; exact-match guards fail the build when an
 * upstream update moves a seam that needs a fresh review.
 */
export function adaptTuiRendererPackage(packageDir) {
  const lib = join(packageDir, 'lib', 'types')
  replaceOnce(
    join(lib, 'components', 'LogoV2.js'),
    "sweep('✦ dsh-cc', t, wordmarkRGB, wordmarkShimmerRGB, 60)",
    "sweep(process.env.DSH_STUDIO_TUI_TITLE ?? 'DSH Studio TUI', t, wordmarkRGB, wordmarkShimmerRGB, 60)",
  )
  replaceOnce(
    join(lib, 'components', 'LogoV2.js'),
    "'  v' + VERSION",
    "'  v' + (process.env.DSH_STUDIO_TUI_VERSION ?? VERSION)",
  )
  replaceOnce(
    join(lib, 'screens', 'Chat.js'),
    'useTerminalTitle(`${titlePrefix} 🐋 ${channel.sessionTitle}`);',
    "useTerminalTitle(`${titlePrefix} ${process.env.DSH_STUDIO_TUI_TITLE ?? 'DSH Studio TUI'} · ${channel.sessionTitle}`);",
  )
  replaceOnce(
    join(lib, 'customTheme.js'),
    "export const CUSTOM_THEME_DIR = join(homedir(), '.dsh-cc', 'themes');",
    "export const CUSTOM_THEME_DIR = join(process.env.DSH_STUDIO_TUI_CONFIG_HOME ?? join(homedir(), '.dsh-studio', 'tui'), 'themes');",
  )
  for (const name of [
    'activityPrefs.js',
    'effortPrefs.js',
    'i18n.js',
    'modelPrefs.js',
    'presetPrefs.js',
    'themePrefs.js',
  ]) {
    scopePreferenceFile(lib, name)
  }
  scopePreferenceFile(lib, 'history.js', 'HISTORY_DIR')
  scopePreferenceFile(lib, 'sessionHistory.js', 'DIR')

  const commands = join(lib, 'commands.js')
  replaceOnce(
    commands,
    "description: 'Show the dsh-cc configuration source'",
    "description: 'Show the DSH Studio TUI configuration source'",
  )
  replaceOnce(
    commands,
    "description: 'Practice programming with dsh-cc'",
    "description: 'Practice programming with DSH Studio TUI'",
  )
  replaceOnce(
    commands,
    "description: 'Exit dsh-cc'",
    "description: 'Exit DSH Studio TUI'",
  )

  const plugin = join(lib, 'plugin.js')
  replaceEvery(plugin, 'dsh-cc --resume', 'dsh-studio tui --resume')
  replaceOnce(plugin, 'Resume with -c (or command below):', 'Resume with:')
  replaceEvery(
    plugin,
    'cc-tui requires an interactive terminal',
    'DSH Studio TUI requires an interactive terminal',
  )
  replaceEvery(
    plugin,
    'cc-tui: exit after error:',
    'DSH Studio TUI: exit after error:',
  )
  replaceEvery(plugin, 'cc-tui crashed:', 'DSH Studio TUI crashed:')

  const messages = join(lib, 'i18n.js')
  replaceEvery(messages, '~/.dsh-cc', '~/.dsh-studio/tui')
  replaceEvery(messages, 'dsh-cc.cmd / dsh --config <上述任一配置>', 'dsh-studio tui')
  replaceEvery(messages, 'dsh-cc.cmd / dsh --config <either config above>', 'dsh-studio tui')
  replaceEvery(messages, 'dsh-cc', 'DSH Studio TUI')

  const channel = join(lib, 'channel.js')
  replaceOnce(
    channel,
    '`dsh-cc-export-${Date.now()}.md`',
    '`dsh-studio-tui-export-${Date.now()}.md`',
  )
  replaceOnce(
    channel,
    "join(userHome, '.dsh-cc/cordis.yml')",
    "join(process.env.DSH_STUDIO_TUI_CONFIG_HOME ?? join(userHome, '.dsh-studio', 'tui'), 'cordis.yml')",
  )
  replaceOnce(
    channel,
    "join(userHome, '.dsh-cc/sessions')",
    "join(process.env.DSH_STUDIO_TUI_CONFIG_HOME ?? join(userHome, '.dsh-studio', 'tui'), 'sessions')",
  )

  replaceOnce(
    join(lib, 'screens', 'Chat.js'),
    '`${userHome}\\\\.dsh-cc\\\\cordis.yml`',
    '`${process.env.DSH_STUDIO_TUI_CONFIG_HOME ?? `${userHome}\\\\.dsh-studio\\\\tui`}\\\\cordis.yml`',
  )

  const customTheme = join(lib, 'customTheme.js')
  replaceEvery(customTheme, '[dsh-cc-tui]', '[DSH Studio TUI]')
  replaceEvery(customTheme, '~/.dsh-cc', '~/.dsh-studio/tui')
  const themeProvider = join(lib, 'components', 'design-system', 'ThemeProvider.js')
  replaceEvery(themeProvider, '[dsh-cc-tui]', '[DSH Studio TUI]')
  replaceEvery(themeProvider, '~/.dsh-cc', '~/.dsh-studio/tui')
}
