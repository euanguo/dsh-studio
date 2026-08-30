/**
 * Generic plugin CSS pipeline: turns every `*.module.css` under
 * `plugins/<dir>/src/client/` into one scoped stylesheet + per-file class
 * maps (`styles.ts`), consumed by the plugin's client bundle.
 *
 * Scoping and modern-syntax expansion are delegated to `lightningcss`
 * (the Rust CSS engine from the esbuild project) with its CSS Modules mode:
 * - class names are RENAMED per file (`<class>` → `ohlr-<hash>-<class>`), so
 *   same-named classes in different files never collide (official per-file
 *   hashing) and no scope attribute is needed — portaled menus/dialogs keep
 *   their styles;
 * - nesting (`&`, nested rules), `@media` blocks, `@keyframes` (renamed
 *   consistently with their references) and `:global(...)` segments are all
 *   handled by the engine — the previous hand-rolled regex scoper could not
 *   process nested rules and silently left outer selectors unscoped.
 *   Nesting is PRESERVED as native CSS in the output (Chromium 104+ /
 *   Safari 16.5+ / Firefox 117+ all support it; the Electron and web
 *   surfaces target those), with every class scoped per file; module
 *   authors can write nesting freely and the engine keeps it valid;
 * - custom properties, `corner-shape` and other modern syntax pass through.
 *
 * CLI: node scripts/plugin-styles.mjs <plugin-dir> [--check]
 * e.g.  node scripts/plugin-styles.mjs desktop-left-rail
 *       node scripts/plugin-styles.mjs desktop-left-rail --check
 *
 * Output: plugins/<dir>/src/client/styles.ts (committed) exporting one class
 * map per CSS file (`<FileStem>Css`) plus the merged `pluginCss` string.
 * `--check` regenerates in memory and fails when the committed file drifted
 * (wired into scripts/build.mjs as a drift gate).
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = 'ohlr'
/** Content-hash scoping (official CSS Modules style, collision-proof). */
const PATTERN = `${PREFIX}-[hash]-[local]`

/** Recursively find `*.module.css` under a directory. */
function findModuleCss(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...findModuleCss(full))
    else if (entry.endsWith('.module.css')) out.push(full)
  }
  return out
}

/** `WorkspaceBrowser.module.css` → `WorkspaceBrowserCss`, `side-tools.module.css` → `SideToolsCss` */
function exportName(file) {
  const stem = file.replace(/\.module\.css$/, '')
  const pascal = stem.replace(/(^|-)([a-z])/g, (_, _sep, ch) => ch.toUpperCase())
  return `${pascal}Css`
}

/** Explicit stylesheet join order per plugin (cascade-sensitive global rules
 *  must keep their historical order). Files not listed keep alphabetical
 *  order. */
const PLUGIN_CSS_ORDER = {
  sidebar: [
    'sidebar.module.css',
    'side-tools.module.css',
    'source-control/source-control.module.css',
    'surfaces/center-surface.module.css',
    'diff/diff-viewer.module.css',
  ],
}

/** Per-plugin aggregate class map, so components import one stable name
 *  (e.g. `SidebarSurfaceCss`) regardless of how many module files the
 *  plugin is split into. */
const PLUGIN_AGGREGATE = {
  sidebar: 'SidebarSurfaceCss',
}

/** Transform one module stylesheet into `{ css, mapEntries }`. */
function transformModuleCss(clientDir, rel) {
  // Git may materialize text files as CRLF on Windows. Normalize before
  // hashing and transforming so CSS-module names are platform-independent.
  const source = readFileSync(join(clientDir, rel), 'utf8').replace(/\r\n?/g, '\n')
  const result = transform({
    filename: rel.replaceAll('\\', '/'),
    code: Buffer.from(source),
    cssModules: { pattern: PATTERN },
    minify: false,
  })
  const css = result.code.toString('utf8')
  // Class-only map: CSS Modules also exports dashed idents (keyframe and
  // custom-property names), which must not appear in the class map. Keep a
  // local name only when it is an ACTUAL `.class` occurrence in the source
  // (dashed class names like `dsh-studio-row` stay, keyframe names drop).
  const classNames = new Set()
  for (const line of source.split('\n')) {
    const stripped = line.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of stripped.matchAll(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g)) classNames.add(match[1])
  }
  const entries = Object.entries(result.exports)
    .filter(([, value]) => typeof value?.name === 'string')
    .filter(([local]) => classNames.has(local))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([local, value]) => {
      const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(local) ? local : JSON.stringify(local)
      return `  ${key}: '${value.name}',`
    })
  return { css, entries }
}

/**
 * Generate `styles.ts` for one plugin; returns the written file path.
 * Pass `{ check: true }` to validate the committed file instead of writing.
 */
export function generatePluginStyles(pluginDir, { check = false } = {}) {
  const clientDir = join(root, 'plugins', pluginDir, 'src', 'client')
  let files = findModuleCss(clientDir)
  const ordered = PLUGIN_CSS_ORDER[pluginDir]
  if (ordered !== undefined) {
    files = ordered.map(rel => join(clientDir, rel))
    const missing = files.find(path => !existsSync(path))
    if (missing !== undefined) {
      throw new Error(`plugin-styles ${pluginDir}: ordered file missing: ${missing}`)
    }
  } else {
    files.sort()
  }
  if (files.length === 0) throw new Error(`plugin-styles: no *.module.css under ${clientDir}`)

  let cssText = ''
  const exports = []
  for (const file of files) {
    const rel = relative(clientDir, file).replaceAll('\\', '/')
    const { css, entries } = transformModuleCss(clientDir, rel)
    cssText += `/* ${rel} */\n${css}\n`
    exports.push(`export const ${exportName(rel.split('/').pop())} = {
${entries.join('\n')}
} as const`)
  }

  const aggregate = PLUGIN_AGGREGATE[pluginDir]
  const aggregateExport = aggregate === undefined
    ? ''
    : `export const ${aggregate} = {\n${files
      .map(file => `  ...${exportName(relative(clientDir, file).replaceAll('\\', '/').split('/').pop())},`)
      .join('\n')}\n} as const\n`

  const output = `/**
 * Generated by scripts/plugin-styles.mjs — do not edit by hand.
 * Per-file renamed class maps + merged scoped stylesheet for the forked
 * official CSS (lightningcss CSS Modules: per-file content-hash scoping so
 * same-named classes never collide; nesting flattened by the engine).
 */
${exports.join('\n')}
${aggregateExport}
export const pluginCss = ${JSON.stringify(cssText)}
`
  const outPath = join(clientDir, 'styles.ts')
  if (check) {
    const committed = readFileSync(outPath, 'utf8').replace(/\r\n?/g, '\n')
    if (committed !== output) {
      throw new Error(
        `plugin-styles ${pluginDir}: styles.ts drifted from the module CSS sources.\n`
        + `Run \`node scripts/plugin-styles.mjs ${pluginDir}\` and commit the regeneration.`,
      )
    }
    console.log(`plugin-styles ${pluginDir}: up to date (${files.length} files, ${cssText.length} bytes css)`)
    return outPath
  }
  writeFileSync(outPath, output)
  console.log(`plugin-styles ${pluginDir}: ${files.length} files, ${cssText.length} bytes css`)
  return outPath
}

// CLI mode.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [pluginDir, flag] = process.argv.slice(2)
  if (pluginDir === undefined) {
    console.error('usage: node scripts/plugin-styles.mjs <plugin-dir> [--check]')
    process.exit(2)
  }
  try {
    generatePluginStyles(pluginDir, { check: flag === '--check' })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}