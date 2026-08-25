#!/usr/bin/env node
/**
 * guard-no-inline-probe.mjs — upstream DOM probes live only in probe modules.
 *
 * S4 rule: selectors, `data-slot`, aria-label, and computed-class probes into
 * the upstream DSH web client's DOM may only exist in each plugin's single
 * probe module (sidebar `dsh-dom.ts`, marketplace `marketplace-dom.ts`,
 * skins `skin-dom.ts`+`generated-selectors.ts`) and the generated style
 * pipeline outputs (`styles.ts`, `chunk-loader.ts`). After the W4 refactor
 * all JS upstream probes moved into those modules; this guard is the CI
 * tripwire that keeps them there.
 *
 * Scope: feature JS/TS under `plugins/{sidebar,plugin-marketplace,
 * desktop-left-rail}/src/client`. A violation is an inline DOM query
 * (`closest`/`querySelector(All)`/`matches`/`getComputedStyle`) whose
 * selector literal reaches the upstream chrome — an upstream slot
 * (`conversation`, `sidebar`) or an upstream class/aria attribute probe.
 * Querying the plugin's OWN declared slots (e.g. `[data-slot="surface-tab"]`,
 * `[data-line]`) is not an upstream probe and is allowed.
 *
 * The probe modules that are EXEMPT from this rule and the reason:
 *   - sidebar surfacing/dsh-dom.ts, marketplace marketplace-dom.ts — the
 *     pinned upstream-probe singletons.
 *   - desktop-skins skin-dom.ts + generated-selectors.ts — generated/pinned.
 *   - *.styles.ts and chunk-loader.ts — generated style-pipeline output.
 *
 * Upstream CSS overrides that pin upstream chrome remain a skin/theme
 * adaptation tracked by rescan.mjs, distinct from inline feature probes.
 *
 * Output: violation list (file:line) then exit 1; clean prints `GUARD-OK`
 * and exits 0.
 *
 * Usage: node scripts/guards/guard-no-inline-probe.mjs [--verbose]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Feature client roots the guard polices (interactive plugins that render into
// the DSH client). desktop-skins owns its own probe/generated layer.
const FEATURE_ROOTS = [
  'plugins/sidebar/src/client',
  'plugins/plugin-marketplace/src/client',
  'plugins/desktop-left-rail/src/client',
]

// Probe / generated modules exempt from the rule (see header).
const ALLOWLIST = (p) =>
  p.endsWith('/surfaces/dsh-dom.ts') ||
  p.endsWith('/marketplace-dom.ts') ||
  p.endsWith('/skin-dom.ts') ||
  p.endsWith('/generated-selectors.ts') ||
  p.endsWith('/styles.ts') ||
  p.endsWith('/chunk-loader.ts')

// Upstream slot names in the DSH web client's own DOM. Selectors targeting
// these from feature code are upstream probes.
const UPSTREAM_SLOTS = ['conversation', 'sidebar']

// A DOM query whose selector literal reaches upstream chrome.
const PROBE_RE = new RegExp(
  String.raw`(?:closest|querySelector|querySelectorAll|matches|getComputedStyle|\.query)\s*\(\s*[\`"']\s*` +
    String.raw`(?:\[data-slot\s*=\s*['"](?:conversation|sidebar)['"]\]|\[class\*=|\[aria-)`,
)

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'dist' || e.name === 'node_modules') continue
      walk(p, out)
    } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
      out.push(p)
    }
  }
  return out
}

const violations = []
let scanned = 0
for (const rel of FEATURE_ROOTS) {
  const dir = join(root, rel)
  let st
  try {
    st = statSync(dir)
  } catch {
    continue
  }
  if (!st.isDirectory()) continue
  for (const file of walk(dir, [])) {
    const r = relative(root, file)
    if (ALLOWLIST(r)) continue
    scanned++
    const text = readFileSync(file, 'utf8')
    PROBE_RE.lastIndex = 0
    let m
    while ((m = PROBE_RE.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length
      violations.push(`${r}:${line}`)
    }
  }
}

if (violations.length > 0) {
  console.log(`VIOLATIONS guard-no-inline-probe (${violations.length}):`)
  for (const v of violations) console.log(`  ${v}`)
  process.exit(1)
}
console.log(`guard-no-inline-probe scanned ${scanned} feature files; upstream probes confined to probe modules`)
console.log('GUARD-OK')