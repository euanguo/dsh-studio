/**
 * Generic plugin CSS pipeline: turns every `*.module.css` under
 * `plugins/<dir>/src/client/` into one scoped stylesheet + per-file class
 * maps (`styles.ts`), consumed by the plugin's client bundle.
 *
 * Scoping mirrors the official CSS Modules build: class names are RENAMED per
 * file (`<class>` → `ohlr-<kebab-file-stem>-<class>`), so same-named classes
 * in different files never collide (official: per-file hashes) and no scope
 * attribute is needed — portaled menus/dialogs keep their styles.
 * - Comments are stripped before processing (comment text must never be
 *   treated as selectors); `@media` blocks recurse; `@keyframes` are copied
 *   verbatim (their names are document-global).
 * - `:global(...)` segments are left untouched.
 *
 * CLI: node scripts/plugin-styles.mjs <plugin-dir>
 * e.g.  node scripts/plugin-styles.mjs desktop-left-rail
 *
 * Output: plugins/<dir>/src/client/styles.ts (committed) exporting one class
 * map per CSS file (`<FileStem>Css`) plus the merged `pluginCss` string.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = 'ohlr'

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

/** Drop CSS comments: comment text must never be treated as selectors. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** `WorkspaceBrowser.module.css` → `workspace-browser` */
function kebabStem(file) {
  return file
    .replace(/\.module\.css$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

/** `WorkspaceBrowser.module.css` → `WorkspaceBrowserCss` */
function exportName(file) {
  const stem = file.replace(/\.module\.css$/, '')
  return `${stem}Css`
}

/** Class names declared in one stylesheet (selector positions only). */
function collectClassNames(source) {
  const names = new Set()
  const re = /\.([_a-zA-Z][_a-zA-Z0-9-]*)/g
  for (const match of source.matchAll(re)) names.add(match[1])
  return names
}

/** Rename one rule's selectors: every class token in this file's class set
 *  gets the per-file prefix; :global(...) segments are left untouched. */
function renameSelectors(selectors, classNames, prefix) {
  return selectors
    .split(',')
    .map(segment => {
      const trimmed = segment.trim()
      if (trimmed.startsWith(':global(')) return segment
      return trimmed.replace(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g, (_, name) =>
        classNames.has(name) ? `.${prefix}-${name}` : `.${name}`)
    })
    .join(',')
}

/**
 * Scope one stylesheet: ordinary rules get renamed selectors; @media blocks
 * recurse; @keyframes are copied verbatim (their names are document-global
 * and the inner selectors are animation frames, not element selectors).
 */
function scopeDocument(source, classNames, prefix) {
  let out = ''
  let i = 0
  while (i < source.length) {
    if (source[i] === '@') {
      const open = source.indexOf('{', i)
      if (open === -1) { out += source.slice(i); break }
      let depth = 0
      let j = open
      for (; j < source.length; j += 1) {
        if (source[j] === '{') depth += 1
        else if (source[j] === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      const header = source.slice(i, open)
      const body = source.slice(open + 1, j)
      if (/^@keyframes|^@-webkit-keyframes/.test(header)) {
        out += `${header}{${body}}\n`
      } else {
        out += `${header}{\n${scopeDocument(body, classNames, prefix)}\n}\n`
      }
      i = j + 1
    } else {
      const next = source.indexOf('@', i)
      const chunk = next === -1 ? source.slice(i) : source.slice(i, next)
      out += chunk.replace(
        /([^{}]+)\{([^{}]*)\}/g,
        (_, selectors, body) => `${renameSelectors(selectors, classNames, prefix)} {\n${body}\n}`,
      )
      i = next === -1 ? source.length : next
    }
  }
  return out
}

/** Generate `styles.ts` for one plugin; returns the written file path. */
export function generatePluginStyles(pluginDir) {
  const clientDir = join(root, 'plugins', pluginDir, 'src', 'client')
  const files = findModuleCss(clientDir).sort()
  if (files.length === 0) throw new Error(`plugin-styles: no *.module.css under ${clientDir}`)

  let cssText = ''
  const exports = []
  for (const file of files) {
    const rel = relative(clientDir, file)
    const stem = kebabStem(rel.split('/').pop())
    const prefix = `${PREFIX}-${stem}`
    const source = stripComments(readFileSync(file, 'utf8'))
    const classNames = collectClassNames(source)
    cssText += `/* ${rel} */\n${scopeDocument(source, classNames, prefix)}\n`
    const entries = [...classNames].sort()
      .map(name => `  ${name}: '${prefix}-${name}'`)
      .join(',\n')
    exports.push(`export const ${exportName(rel.split('/').pop())}: Record<string, string> = {
${entries},
}`)
  }

  const output = `/**
 * Generated by scripts/plugin-styles.mjs — do not edit by hand.
 * Per-file renamed class maps + merged scoped stylesheet for the forked
 * official CSS (class names carry the per-file prefix, mirroring the
 * official per-file hashing so same-named classes never collide).
 */
${exports.join('\n')}

export const pluginCss = ${JSON.stringify(cssText)}
`
  const outPath = join(clientDir, 'styles.ts')
  writeFileSync(outPath, output)
  console.log(`plugin-styles ${pluginDir}: ${files.length} files, ${cssText.length} bytes css`)
  return outPath
}

// CLI mode.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [pluginDir] = process.argv.slice(2)
  if (pluginDir === undefined) {
    console.error('usage: node scripts/plugin-styles.mjs <plugin-dir>')
    process.exit(2)
  }
  generatePluginStyles(pluginDir)
}
