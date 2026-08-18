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
 * Update: the terminal insets `.xterm` with 8px padding (a uniform breathing
 * inset that FitAddon subtracts). The scrollable height must therefore be the
 * host's CONTENT height (clientHeight − top/bottom padding), or the scrollbar
 * region would overflow the padded box by 8px.
 *
 * Also patches lib/xterm.mjs (ESM twin) so both entries carry the fix.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Original upstream code.
const ORIGINAL = 'setScrollDimensions({height:this._renderService.dimensions.css.canvas.height,scrollHeight:this._renderService.dimensions.css.cell.height*this._bufferService.buffer.lines.length})'
// First patch version (viewport height, no padding subtraction) — still present
// in installs that predate the .xterm padding work; upgraded in place.
const OLD_PATCH = 'setScrollDimensions({height:(this._scrollableElement.getDomNode().parentElement&&this._scrollableElement.getDomNode().parentElement.clientHeight>0?this._scrollableElement.getDomNode().parentElement.clientHeight:this._renderService.dimensions.css.canvas.height),scrollHeight:this._renderService.dimensions.css.cell.height*this._bufferService.buffer.lines.length})'
// Current patch: scrollable height = host CONTENT height (clientHeight minus
// top/bottom padding) so it matches the 8px .xterm inset.
const NEW_PATCH = 'setScrollDimensions({height:(this._scrollableElement.getDomNode().parentElement&&this._scrollableElement.getDomNode().parentElement.clientHeight>0?(this._scrollableElement.getDomNode().parentElement.clientHeight-((parseInt(getComputedStyle(this._scrollableElement.getDomNode().parentElement).paddingTop)||0)+(parseInt(getComputedStyle(this._scrollableElement.getDomNode().parentElement).paddingBottom)||0))):this._renderService.dimensions.css.canvas.height),scrollHeight:this._renderService.dimensions.css.cell.height*this._bufferService.buffer.lines.length})'

const PRESETS = [ORIGINAL, OLD_PATCH]

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
  if (src.includes(NEW_PATCH)) {
    console.log(`[apply-xterm-patch] ${file}: already patched`)
    continue
  }
  const preset = PRESETS.find(p => src.includes(p))
  if (preset === undefined) {
    console.warn(`[apply-xterm-patch] ${file}: target pattern not found — xterm version changed? SKIPPED`)
    continue
  }
  writeFileSync(path, src.replace(preset, NEW_PATCH))
  changed = true
  console.log(`[apply-xterm-patch] ${file}: ${preset === ORIGINAL ? 'patched' : 'upgraded to padding-aware patch'}`)
}

if (!changed) console.log('[apply-xterm-patch] done (no changes)')
