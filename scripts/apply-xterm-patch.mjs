#!/usr/bin/env node
/**
 * Apply the Oh-DSH xterm 6.1 scrollbar-height fix to the installed package.
 *
 * Why a script instead of pnpm patchedDependencies: xterm's published
 * `lib/xterm.js` is one minified line (~390 KB), so `pnpm patch-commit`
 * produces a whole-file diff that pnpm refuses to apply. This script does
 * the same one-string replacement in place and is idempotent, so it is safe
 * to run on every install (package.json "postinstall").
 *
 * Fix: in Viewport#_sync, the scrollable-element height is set to
 * `canvas.height` (= rows × cellHeight, floored), which is SHORTER than the
 * viewport when the container height is not an exact multiple of the cell
 * height. Consequences: a permanent gap below the content, a DOM scrollbar
 * (slider) that never reaches the viewport bottom, and a scrollbar that
 * appears as soon as one scrollback line exists. Setting the scrollable
 * height to the host element's clientHeight aligns the scrollbar with the
 * viewport and makes "scrollbar appears" coincide with "content fills the
 * screen".
 *
 * Also patches lib/xterm.mjs (ESM twin) so both entries carry the fix.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const OLD = 'setScrollDimensions({height:this._renderService.dimensions.css.canvas.height,scrollHeight:this._renderService.dimensions.css.cell.height*this._bufferService.buffer.lines.length})'
const NEW = 'setScrollDimensions({height:(this._scrollableElement.getDomNode().parentElement&&this._scrollableElement.getDomNode().parentElement.clientHeight>0?this._scrollableElement.getDomNode().parentElement.clientHeight:this._renderService.dimensions.css.canvas.height),scrollHeight:this._renderService.dimensions.css.cell.height*this._bufferService.buffer.lines.length})'

function locatePackage() {
  const pnpmDir = join(root, 'node_modules', '.pnpm')
  if (!existsSync(pnpmDir)) return null
  let entries = []
  try {
    entries = readdirSync(pnpmDir)
  } catch {
    return null
  }
  // Multiple xterm copies can coexist (6.0.0 vs 6.1.0-beta, plus stale
  // `_patch_hash=` leftovers). The app bundles the plain beta line — the
  // newest entry WITHOUT a patch_hash suffix.
  const hits = entries.filter(entry => entry.startsWith('@xterm+xterm@') && !entry.includes('patch_hash'))
  const hit = hits[hits.length - 1]
  if (!hit) return null
  return join(pnpmDir, hit, 'node_modules', '@xterm', 'xterm')
}

const pkgRoot = locatePackage()
if (pkgRoot === null) {
  console.warn('[apply-xterm-patch] @xterm/xterm package not found; skipping')
  process.exit(0)
}

let changed = false
for (const file of ['lib/xterm.js', 'lib/xterm.mjs']) {
  const path = join(pkgRoot, file)
  if (!existsSync(path)) continue
  const src = readFileSync(path, 'utf8')
  if (src.includes(NEW)) {
    console.log(`[apply-xterm-patch] ${file}: already patched`)
    continue
  }
  if (!src.includes(OLD)) {
    console.warn(`[apply-xterm-patch] ${file}: target pattern not found — xterm version changed? SKIPPED`)
    continue
  }
  writeFileSync(path, src.replace(OLD, NEW))
  changed = true
  console.log(`[apply-xterm-patch] ${file}: patched`)
}

if (!changed) console.log('[apply-xterm-patch] done (no changes)')
