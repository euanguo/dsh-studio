#!/usr/bin/env node
/**
 * bump-dsh.mjs — stepwise DSH pin bump planner/applicator (kernel-refactor
 * leaf-4.2). Encodes the manual five-step runbook that follows every change
 * of the upstream pin in config/dsh-dependencies.json (the single writable
 * fact source, leaf-4.1):
 *
 *   1. facts      dsh-source.json regenerates from the config pin
 *                 (node scripts/sync-dsh-dependencies.mjs)
 *   2. lock       scripts/dsh-runtime-<version>-lock.yaml exists and is
 *                 identical to the pinned tarball assembly's pnpm-lock.yaml
 *                 (stage-dsh installs the runtime with --frozen-lockfile
 *                 from exactly this file)
 *   3. patches    patches/dsh-runtime/*.patch validate structurally and on
 *                 the staged runtime (.stage/dsh-runtime) either forward-
 *                 apply cleanly or are already applied; both directions
 *                 failing means the patch must be re-pinned by hand — the
 *                 conflict carries a bounded snippet of the target source
 *                 line to re-anchor against
 *   4. selectors  plugins/desktop-skins/src/client/generated-selectors.ts
 *                 records the `// DSH revision:` marker of the resolved DSH
 *                 source (skipped when no local build can anchor it — the
 *                 generator itself skips under the same condition)
 *   5. types      .cache/dsh-source/npm-types installs exactly the pinned
 *                 version of every typePackages package (pnpm run build:dsh)
 *
 * Every step runs its preflight check FIRST. Any failure collects one entry
 * into the structured conflict report `{step, expected, actual, file, fix}[]`
 * printed as JSON before exit 1. The script never commits and never touches
 * dist/, .stage/, release/ or caches.
 *
 * Usage:
 *   node scripts/bump-dsh.mjs --dry-run [version]
 *       Print the full step plan for the current pinned version (or the
 *       given version label) and run every read-only preflight check.
 *       ZERO file mutation by construction: only reads, existence probes,
 *       and `git apply --check`. Prints BUMP-DRYRUN-OK when no conflicts
 *       remain, exit 0.
 *   node scripts/bump-dsh.mjs
 *       Apply mode for an already-updated pin: refuses to mutate anything
 *       while any preflight conflict exists; otherwise executes the safe
 *       local steps (facts regeneration via the existing generator, lock
 *       placement from the cached assembly, selector regeneration when a
 *       local DSH build exists) and prints the exact operator commands for
 *       the heavy steps (types reinstall, patch re-pin). Still never runs
 *       git commit/add.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_SOURCE_SPEC } from './dsh-source.mjs'
import {
  PATCH_FILES,
  checkRuntimePatch,
  validatePatchPath,
  validatePatchSource,
} from './dsh-runtime-patches.mjs'
import {
  deriveDshSource,
  readDependencyFacts,
} from './sync-dsh-dependencies.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = join(scriptDir, '..')

/** Step ids in execution order — one per runbook fact. */
export const BUMP_STEP_IDS = Object.freeze(['facts', 'lock', 'patches', 'selectors', 'types'])

const SELECTORS_MODULE = 'plugins/desktop-skins/src/client/generated-selectors.ts'
const STAGED_RUNTIME_PACKAGE = join('.stage', 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh-client-ui-layout')

/**
 * One structured conflict entry. Every field is always a non-empty string so
 * downstream tooling can rely on the shape.
 * @returns {{step: string, expected: string, actual: string, file: string, fix: string}}
 */
function conflict(step, expected, actual, file, fix) {
  return { step, expected, actual, file, fix }
}

/** Deterministic deep-equality key for parsed JSON pins. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** First differing field path between two parsed JSON values, '' if equal. */
export function firstDifferencePath(expected, actual, prefix = '') {
  if (stableStringify(expected) === stableStringify(actual)) return ''
  const bothObjects = expected !== null && actual !== null
    && typeof expected === 'object' && typeof actual === 'object'
    && !Array.isArray(expected) && !Array.isArray(actual)
  if (!bothObjects) return prefix || '(root)'
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const path = firstDifferencePath(expected[key], actual[key], `${prefix}.${key}`)
    if (path !== '') return path
  }
  return prefix || '(root)'
}

/* ---------- step 1: facts ---------- */

/** dsh-source.json must equal the manifest derived from the config pin. */
export function evaluateFactsStep({ configFacts, manifest }) {
  const expected = deriveDshSource(configFacts)
  if (stableStringify(manifest) === stableStringify(expected)) return []
  return [conflict(
    'facts',
    `dsh-source.json equals the config-derived manifest (${expected.version})`,
    `field drift at ${firstDifferencePath(expected, manifest)}`,
    'dsh-source.json',
    'run node scripts/sync-dsh-dependencies.mjs to regenerate dsh-source.json from config/dsh-dependencies.json',
  )]
}

/* ---------- step 2: lock ---------- */

/**
 * The pinned release lockfile must exist and match the tarball assembly's
 * own pnpm-lock.yaml byte-for-byte (stage-dsh copies it in place before the
 * frozen-lockfile install).
 */
export function evaluateLockStep({ version, releaseLockText, assemblyLockText }) {
  const releaseFile = `scripts/dsh-runtime-${version}-lock.yaml`
  if (releaseLockText === null) {
    return [conflict(
      'lock',
      `${releaseFile} present`,
      'missing',
      releaseFile,
      `copy pnpm-lock.yaml out of the pinned tarball assembly (.cache/dsh-source/npm-${version}/assembly) once it has been fetched, or run pnpm run stage:dsh once`,
    )]
  }
  if (assemblyLockText !== null && releaseLockText !== assemblyLockText) {
    return [conflict(
      'lock',
      `${releaseFile} identical to the assembly pnpm-lock.yaml`,
      `differs (${releaseLockText.length} vs ${assemblyLockText.length} chars)`,
      releaseFile,
      `re-copy .cache/dsh-source/npm-${version}/assembly/pnpm-lock.yaml over ${releaseFile}`,
    )]
  }
  return []
}

/* ---------- step 3: patches ---------- */

/** Structural validation of one committed patch (no filesystem writes). */
export function evaluatePatchStructureStep(relativePath, patchText) {
  try {
    validatePatchPath(relativePath)
    validatePatchSource(patchText, relativePath)
    return []
  } catch (error) {
    return [conflict(
      'patches',
      'patch passes structural validation (existing text files under patches/dsh-runtime/, complete git headers)',
      error instanceof Error ? error.message : String(error),
      relativePath,
      'regenerate the patch against node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js',
    )]
  }
}

/**
 * Map one forward/reverse applicability probe onto conflict entries. Only
 * BOTH directions failing is a conflict: forward-ok means the next stage
 * applies it, reverse-ok means it is already applied.
 */
export function patchApplyConflicts({ relativePath, forward, reverse, snippet }) {
  if (forward.status === 0) return []
  if (reverse !== null && reverse.status === 0) return []
  const detail = [forward.detail, reverse?.detail].filter(Boolean).join('\n').split('\n')[0] ?? ''
  return [conflict(
    'patches',
    'git apply --check succeeds forward (or the patch is already applied) against the staged dsh-client-ui-layout/lib/client.js',
    detail === '' ? 'forward and reverse checks both failed' : detail,
    relativePath,
    `re-pin the patch against the new bundle; target context: ${snippet}`,
  )]
}

/**
 * Bounded snippet of the staged client.js around the text a stale patch
 * expects, for re-anchoring a minified/reflowed bundle. Reconstructs the
 * old-side content of the patch's FIRST hunk (context + deletions) and
 * centers a window on its first occurrence in the target source.
 */
export function patchTargetSnippet(clientJsText, patchText, window = 160) {
  const hunk = patchText.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@.*$|^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@$/m)
  if (hunk === null) return ''
  const lines = patchText.slice(hunk.index).split('\n').slice(1)
  const oldLines = []
  for (const line of lines) {
    if (line.startsWith('@@') || line.startsWith('diff --git')) break
    if (line.startsWith(' ') || line.startsWith('-')) oldLines.push(line.slice(1))
  }
  const anchor = oldLines.map(line => line.trim()).find(text => text !== '') ?? ''
  if (anchor === '') return ''
  const at = clientJsText.indexOf(anchor)
  if (at < 0) return anchor.slice(0, window)
  const half = Math.floor(window / 2)
  const start = Math.max(0, at - half)
  const end = Math.min(clientJsText.length, at + anchor.length + half)
  return clientJsText.slice(start, end).replace(/\s+/g, ' ').trim()
}

/* ---------- step 4: selectors ---------- */

/** Recorded `// DSH revision:` marker of generated-selectors.ts. */
export function selectorMarkerFromModuleText(moduleText) {
  return moduleText.match(/^\/\/ DSH revision: (\S+)$/m)?.[1] ?? null
}

/**
 * Marker generate-skin-selectors would record for one resolvable DSH
 * source: basename of the resolved checkout ('assembly' for npm pins WITH
 * built web assets, the 12-char revision prefix for git pins). Returns null
 * when no local source anchors the comparison — the generator itself skips
 * under exactly this condition, so it is not a conflict.
 */
export function expectedSelectorMarker({ spec, envDshSource, assemblyHasWebAssets }) {
  if (envDshSource !== undefined && envDshSource !== '') return basename(resolve(envDshSource))
  if (spec.source === 'git') return spec.revision.slice(0, 12)
  return assemblyHasWebAssets ? 'assembly' : null
}

export function evaluateSelectorsStep({ moduleText, expectedMarker }) {
  if (expectedMarker === null) return []
  const marker = selectorMarkerFromModuleText(moduleText)
  if (marker === expectedMarker) return []
  return [conflict(
    'selectors',
    `${SELECTORS_MODULE} records DSH revision marker ${expectedMarker}`,
    `records ${marker ?? '(none)'}`,
    SELECTORS_MODULE,
    'run pnpm run generate:selectors and review the committed diff',
  )]
}

/* ---------- step 5: types sandbox ---------- */

/** Every typePackages top-level package installed at exactly the pin. */
export function evaluateTypesStep({ sandboxManifest, typePackages, version }) {
  if (sandboxManifest === null) {
    return [conflict(
      'types',
      '.cache/dsh-source/npm-types installed at the pinned version',
      'sandbox package.json missing',
      '.cache/dsh-source/npm-types/package.json',
      'run pnpm run build:dsh',
    )]
  }
  const conflicts = []
  const packages = [...new Set(Object.keys(typePackages)
    .map(specifier => specifier.split('/').slice(0, 2).join('/')))]
  for (const name of packages) {
    const installed = sandboxManifest.devDependencies?.[name]
    if (installed !== version) {
      conflicts.push(conflict(
        'types',
        `${name}@${version} in the type sandbox`,
        `${name}@${installed ?? 'missing'}`,
        '.cache/dsh-source/npm-types/package.json',
        'run pnpm run build:dsh to reinstall the sandbox at the pinned version',
      ))
    }
  }
  return conflicts
}

/* ---------- shared report rendering ---------- */

/** Canonical JSON rendering of the conflict report (parseable, stable order). */
export function renderConflictReport(conflicts) {
  return JSON.stringify(conflicts, null, 2)
}

function assertReportShape(conflicts) {
  for (const entry of conflicts) {
    for (const field of ['step', 'expected', 'actual', 'file', 'fix']) {
      if (typeof entry[field] !== 'string' || entry[field] === '') {
        throw new Error(`conflict report entry ${JSON.stringify(entry)} has no ${field}`)
      }
    }
    if (!BUMP_STEP_IDS.includes(entry.step)) {
      throw new Error(`unknown conflict step: ${entry.step}`)
    }
  }
}

/* ---------- CLI ---------- */

function readTextIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** Resolve every preflight input and evaluate all five steps (read-only). */
export function collectPreflightConflicts(root = repoRoot, spec = DSH_SOURCE_SPEC) {
  const conflicts = []
  const notes = []

  // 1. facts
  const facts = readDependencyFacts(root)
  const manifest = JSON.parse(readFileSync(join(root, 'dsh-source.json'), 'utf8'))
  conflicts.push(...evaluateFactsStep({ configFacts: facts, manifest }))

  // 2. lock
  const assemblyRoot = join(root, '.cache', 'dsh-source', `npm-${spec.version}`, 'assembly')
  conflicts.push(...evaluateLockStep({
    version: spec.version,
    releaseLockText: readTextIfPresent(join(root, 'scripts', `dsh-runtime-${spec.version}-lock.yaml`)),
    assemblyLockText: readTextIfPresent(join(assemblyRoot, 'pnpm-lock.yaml')),
  }))

  // 3. patches (structure always; applicability when a staged runtime exists)
  const stagedManifestPath = join(root, STAGED_RUNTIME_PACKAGE, 'package.json')
  let packageRoot = null
  if (existsSync(stagedManifestPath)) packageRoot = dirname(realpathSync(stagedManifestPath))
  else notes.push('patches: no staged runtime at .stage/dsh-runtime — applicability deferred to pnpm run stage:dsh')
  for (const relativePath of PATCH_FILES) {
    const patchPath = join(root, ...relativePath.split('/'))
    const patchText = readFileSync(patchPath, 'utf8')
    conflicts.push(...evaluatePatchStructureStep(relativePath, patchText))
    if (packageRoot !== null) {
      const { forward, reverse } = checkRuntimePatch(packageRoot, patchPath)
      const clientJsText = readFileSync(join(packageRoot, 'lib', 'client.js'), 'utf8')
      conflicts.push(...patchApplyConflicts({
        relativePath,
        forward,
        reverse,
        snippet: patchTargetSnippet(clientJsText, patchText),
      }))
      if (forward.status !== 0 && reverse !== null && reverse.status === 0) {
        notes.push(`patches: ${relativePath} is already applied on the staged runtime`)
      }
    }
  }

  // 4. selectors
  const envDshSource = process.env.DSH_SOURCE
  const moduleText = readTextIfPresent(join(root, ...SELECTORS_MODULE.split('/')))
  conflicts.push(...evaluateSelectorsStep({
    moduleText: moduleText ?? '',
    expectedMarker: expectedSelectorMarker({
      spec,
      envDshSource,
      assemblyHasWebAssets: existsSync(join(assemblyRoot, 'apps', 'web', 'dist', 'assets')),
    }),
  }))
  if (moduleText === null) {
    conflicts.push(conflict(
      'selectors',
      `${SELECTORS_MODULE} present`,
      'missing',
      SELECTORS_MODULE,
      'restore the generated selectors module (pnpm run generate:selectors)',
    ))
  }

  // 5. types sandbox
  const sandboxManifestText = readTextIfPresent(join(root, '.cache', 'dsh-source', 'npm-types', 'package.json'))
  conflicts.push(...evaluateTypesStep({
    sandboxManifest: sandboxManifestText === null ? null : JSON.parse(sandboxManifestText),
    typePackages: facts.typePackages,
    version: spec.version,
  }))

  assertReportShape(conflicts)
  return { conflicts, notes }
}

function printPlan(spec, labelVersion) {
  console.log(`BUMP PLAN${labelVersion === undefined ? '' : ` → ${labelVersion}`} (pin @deepseek-ai/dsh@${spec.version}, mode ${spec.source})`)
  console.log('  1. facts      regenerate dsh-source.json from config/dsh-dependencies.json')
  console.log(`  2. lock       scripts/dsh-runtime-${spec.version}-lock.yaml matches the assembly lock`)
  console.log('  3. patches    patches/dsh-runtime/*.patch forward/reverse-validate on the staged runtime')
  console.log(`  4. selectors  ${SELECTORS_MODULE} re-pinned for the resolved DSH source`)
  console.log('  5. types      .cache/dsh-source/npm-types installs every typePackages package at the pin')
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run')
  const positional = argv.filter(arg => !arg.startsWith('--'))
  const labelVersion = positional[0]

  if (!dryRun && positional.length > 0) {
    throw new Error('a version argument is only valid together with --dry-run; edit config/dsh-dependencies.json to change the pin')
  }

  printPlan(DSH_SOURCE_SPEC, labelVersion)
  const { conflicts, notes } = collectPreflightConflicts()

  for (const note of notes) console.log(`· ${note}`)

  if (dryRun) {
    if (conflicts.length > 0) {
      console.error(renderConflictReport(conflicts))
      process.exitCode = 1
      return
    }
    console.log('BUMP-DRYRUN-OK')
    return
  }

  // Apply mode: never mutate while a preflight conflict exists.
  if (conflicts.length > 0) {
    console.error(renderConflictReport(conflicts))
    console.error('BUMP-APPLY-REFUSED (resolve the conflicts above first; nothing was modified)')
    process.exitCode = 1
    return
  }

  // Step 1+2: regenerate derived artifacts and place the lock through the
  // existing single-fact generator rather than duplicating its writers.
  const sync = spawnSync(process.execPath, [join(scriptDir, 'sync-dsh-dependencies.mjs')], { stdio: 'inherit' })
  if (sync.status !== 0) throw new Error(`sync-dsh-dependencies.mjs failed with status ${String(sync.status)}`)
  const releaseLock = join(repoRoot, 'scripts', `dsh-runtime-${DSH_SOURCE_SPEC.version}-lock.yaml`)
  const assemblyLock = join(repoRoot, '.cache', 'dsh-source', `npm-${DSH_SOURCE_SPEC.version}`, 'assembly', 'pnpm-lock.yaml')
  if (!existsSync(releaseLock) && existsSync(assemblyLock)) {
    copyFileSync(assemblyLock, releaseLock)
    console.log(`placed ${releaseLock} from the cached assembly`)
  }

  // Step 4: regenerate selectors when a local DSH build can anchor them.
  const assemblyRoot = join(repoRoot, '.cache', 'dsh-source', `npm-${DSH_SOURCE_SPEC.version}`, 'assembly')
  const canAnchorSelectors = process.env.DSH_SOURCE !== undefined
    || DSH_SOURCE_SPEC.source === 'git'
    || existsSync(join(assemblyRoot, 'apps', 'web', 'dist', 'assets'))
  if (canAnchorSelectors) {
    const generate = spawnSync(process.execPath, [join(scriptDir, 'generate-skin-selectors.mjs')], { stdio: 'inherit' })
    if (generate.status !== 0) throw new Error(`generate-skin-selectors.mjs failed with status ${String(generate.status)}`)
  } else {
    console.log('· selectors: no local DSH web build to scan — run `pnpm run generate:selectors` after the first `pnpm run stage:dsh` of the new pin')
  }

  // Step 3+5 stay operator-executed by design: re-pinning a minified bundle
  // diff and reinstalling the type sandbox are judgement calls with network
  // and review implications; the script validates their results instead.
  console.log('BUMP-APPLY-DONE (mechanical steps applied; nothing committed)')
  console.log('operator checklist:')
  console.log('  1. pnpm run build:dsh     # reinstall the npm-types sandbox at the pin (step 5)')
  console.log('  2. pnpm run stage:dsh     # restage the runtime; patches re-apply here (step 3)')
  console.log('  3. pnpm run generate:selectors  # if selectors were deferred above (step 4)')
  console.log('  4. node scripts/bump-dsh.mjs --dry-run  # verify zero conflicts remain')
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
