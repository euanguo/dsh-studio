import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  BUMP_STEP_IDS,
  evaluateFactsStep,
  evaluateLockStep,
  evaluatePatchStructureStep,
  evaluateSelectorsStep,
  evaluateTypesStep,
  expectedSelectorMarker,
  firstDifferencePath,
  patchApplyConflicts,
  patchTargetSnippet,
  renderConflictReport,
  selectorMarkerFromModuleText,
} from '../scripts/bump-dsh.mjs'
import { checkRuntimePatch } from '../scripts/dsh-runtime-patches.mjs'

/** Minimal valid config pin used as the fixture baseline. */
const FACTS = () => ({
  runtime: {
    source: 'npm',
    package: '@deepseek-ai/dsh',
    version: '9.9.9-test',
    integrity: 'sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==',
    tarball: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-9.9.9-test.tgz',
    packageManager: 'pnpm@11.20.0',
  },
  inject: ['@dsh-studio/sidebar'],
  externals: {
    clientBase: ['react'],
    hostCapabilities: ['@deepseek-ai/*'],
    runtimeClient: { module: '@deepseek-ai/dsh-client-runtime/client', plugins: ['sidebar'] },
  },
  typePackages: { '@deepseek-ai/dsh-brand': '@deepseek-ai/dsh-brand/lib/types/index.d.ts' },
  bundles: { desktop: ['@deepseek-ai/dsh-base'], web: ['@deepseek-ai/dsh-base'], tui: ['@deepseek-ai/dsh-base'] },
})

function assertConflictShape(conflicts: readonly { step: string }[]) {
  for (const entry of conflicts) {
    for (const field of ['step', 'expected', 'actual', 'file', 'fix']) {
      assert.equal(typeof (entry as Record<string, unknown>)[field], 'string')
      assert.notEqual((entry as Record<string, unknown>)[field], '')
    }
  }
}

test('the five runbook facts map to ordered step ids', () => {
  assert.deepEqual([...BUMP_STEP_IDS], ['facts', 'lock', 'patches', 'selectors', 'types'])
})

test('facts step conflicts on field-level drift and stays clean when in sync', () => {
  const derived = {
    source: 'npm',
    package: '@deepseek-ai/dsh',
    version: '9.9.9-test',
    integrity: 'sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==',
    tarball: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-9.9.9-test.tgz',
    packageManager: 'pnpm@11.20.0',
  }
  assert.deepEqual(evaluateFactsStep({ configFacts: FACTS(), manifest: derived }), [])

  const stale = { ...derived, integrity: 'sha512-DIFFERENT==' }
  const conflicts = evaluateFactsStep({ configFacts: FACTS(), manifest: stale })
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0]!.step, 'facts')
  assert.match(conflicts[0]!.fix, /sync-dsh-dependencies\.mjs/)
  assert.match(conflicts[0]!.actual, /integrity/)
})

test('firstDifferencePath reports the deepest differing field', () => {
  assert.equal(firstDifferencePath({ a: { b: 1 } }, { a: { b: 1 } }), '')
  assert.equal(firstDifferencePath({ a: { b: 1 } }, { a: { b: 2 } }), '.a.b')
  assert.equal(firstDifferencePath({ a: 1 }, { a: 1, b: 2 }), '.b')
})

test('lock mismatch fixture produces a structured conflict; matching locks stay clean', () => {
  const missing = evaluateLockStep({
    version: '9.9.9-test',
    releaseLockText: null,
    assemblyLockText: 'lockfileVersion: 9.0\n',
  })
  assert.equal(missing.length, 1)
  assert.equal(missing[0]!.step, 'lock')
  assert.equal(missing[0]!.actual, 'missing')
  assert.match(missing[0]!.file, /dsh-runtime-9\.9\.9-test-lock\.yaml$/)
  assert.match(missing[0]!.expected, /present/)

  const mismatch = evaluateLockStep({
    version: '9.9.9-test',
    releaseLockText: 'lockfileVersion: 9.0\nsettings: {}\n',
    assemblyLockText: 'lockfileVersion: 9.0\n',
  })
  assert.equal(mismatch.length, 1)
  assert.equal(mismatch[0]!.step, 'lock')
  assert.match(mismatch[0]!.actual, /differs/)
  assertConflictShape(mismatch)

  assert.deepEqual(evaluateLockStep({
    version: '9.9.9-test',
    releaseLockText: 'lockfileVersion: 9.0\n',
    assemblyLockText: 'lockfileVersion: 9.0\n',
  }), [])
})

const PATCH_TARGET = 'node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js'

/** Structurally valid single-hunk patch against the layout package target. */
function fixturePatch(contextBefore: string, inserted: string, contextAfter: string): string {
  return [
    `diff --git a/${PATCH_TARGET} b/${PATCH_TARGET}`,
    `--- a/${PATCH_TARGET}`,
    `+++ b/${PATCH_TARGET}`,
    '@@ -1,2 +1,3 @@',
    ` ${contextBefore}`,
    `+${inserted}`,
    ` ${contextAfter}`,
    '',
  ].join('\n')
}

function patchPackageRoot(clientJsText: string) {
  const root = mkdtempSync(join(tmpdir(), 'bump-dsh-patch-'))
  const packageRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-layout')
  mkdirSync(join(packageRoot, 'lib'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-layout' }))
  writeFileSync(join(packageRoot, 'lib', 'client.js'), clientJsText)
  return { root, packageRoot }
}

test('patch structure validation accepts a well-formed hunk and rejects forbidden operations', () => {
  assert.deepEqual(
    evaluatePatchStructureStep('patches/dsh-runtime/x.patch', fixturePatch('const a = 1', 'const b = 2', 'const c = 3')),
    [],
  )

  const binary = `${fixturePatch('a', 'b', 'c')}GIT binary patch\n`
  const conflicts = evaluatePatchStructureStep('patches/dsh-runtime/x.patch', binary)
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0]!.step, 'patches')
  assert.match(conflicts[0]!.actual, /only edit existing text files/)
  assertConflictShape(conflicts)
})

test('patch forward AND reverse failure fixture yields one re-pin conflict with a target snippet', () => {
  const clientJsText = 'const unrelated = require("x")\n'
  const patchText = fixturePatch('const expectedOldLine = 1', 'const added = 2', 'const tail = 3')
  const { root, packageRoot } = patchPackageRoot(clientJsText)
  const patchPath = join(root, 'fixture.patch')
  try {
    writeFileSync(patchPath, patchText)
    const probe = checkRuntimePatch(packageRoot, patchPath)
    // Neither direction can apply against this unrelated bundle.
    assert.notEqual(probe.forward.status, 0)
    assert.ok(probe.reverse !== null)
    assert.notEqual(probe.reverse.status, 0)

    const snippet = patchTargetSnippet(clientJsText, patchText)
    assert.ok(snippet.includes('const expectedOldLine = 1'), `snippet should quote the anchor, got: ${snippet}`)

    const conflicts = patchApplyConflicts({ relativePath: 'patches/dsh-runtime/x.patch', forward: probe.forward, reverse: probe.reverse, snippet })
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0]!.step, 'patches')
    assert.match(conflicts[0]!.expected, /git apply --check/)
    assert.match(conflicts[0]!.fix, /re-pin/)
    assert.ok((conflicts[0]! as unknown as { fix: string }).fix.includes('const expectedOldLine'))
    assertConflictShape(conflicts)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a cleanly forward-applicable or already-applied patch raises no conflict', () => {
  const okForward = { status: 0, detail: '' }
  const failedReverse = { status: 1, detail: 'error: reverse check failed' }
  assert.deepEqual(patchApplyConflicts({
    relativePath: 'p.patch', forward: okForward, reverse: failedReverse, snippet: '',
  }), [])

  const alreadyApplied = patchApplyConflicts({
    relativePath: 'p.patch',
    forward: { status: 1, detail: 'error: patch does not apply' },
    reverse: { status: 0, detail: '' },
    snippet: '',
  })
  assert.deepEqual(alreadyApplied, [])
})

test('stale selectors fixture conflicts on the recorded DSH revision marker', () => {
  const moduleText = '// Auto-generated by scripts/generate-skin-selectors.mjs — do not edit by hand.\n// DSH revision: 99f6f02fecdb\nexport const MENU_LIST = Object.freeze([]) as const\n'
  assert.equal(selectorMarkerFromModuleText(moduleText), '99f6f02fecdb')

  const conflicts = evaluateSelectorsStep({ moduleText, expectedMarker: 'abc123def456' })
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0]!.step, 'selectors')
  assert.equal(conflicts[0]!.file, 'plugins/desktop-skins/src/client/generated-selectors.ts')
  assert.match(conflicts[0]!.actual, /99f6f02fecdb/)
  assert.match(conflicts[0]!.fix, /generate:selectors/)
  assertConflictShape(conflicts)

  assert.deepEqual(evaluateSelectorsStep({ moduleText, expectedMarker: '99f6f02fecdb' }), [])
  // No local anchor → the generator skips too, so no conflict.
  assert.deepEqual(evaluateSelectorsStep({ moduleText: '', expectedMarker: null }), [])
})

test('expected selector marker mirrors the generator source resolution', () => {
  const npm = { source: 'npm' }
  assert.equal(expectedSelectorMarker({ spec: npm, assemblyHasWebAssets: true }), 'assembly')
  assert.equal(expectedSelectorMarker({ spec: npm, assemblyHasWebAssets: false }), null)
  assert.equal(
    expectedSelectorMarker({
      spec: { source: 'git', revision: '99f6f02fecdbabcdef1234567890abcdef123456' },
      assemblyHasWebAssets: false,
    }),
    '99f6f02fecdb',
  )
  assert.equal(expectedSelectorMarker({ spec: npm, envDshSource: '/tmp/some-checkout', assemblyHasWebAssets: false }), 'some-checkout')
})

test('types sandbox fixture conflicts on version drift and missing manifest', () => {
  const typePackages = { '@deepseek-ai/dsh-brand': 'x.d.ts', '@deepseek-ai/dsh-session/surface': 'y.d.ts' }

  const drifted = evaluateTypesStep({
    sandboxManifest: { devDependencies: { '@deepseek-ai/dsh-brand': '0.1.1-rc.2', '@deepseek-ai/dsh-session': '0.1.0-old' } },
    typePackages,
    version: '0.1.1-rc.2',
  })
  assert.equal(drifted.length, 1)
  assert.equal(drifted[0]!.step, 'types')
  assert.match(drifted[0]!.actual, /@deepseek-ai\/dsh-session@0\.1\.0-old/)
  assertConflictShape(drifted)

  const missing = evaluateTypesStep({ sandboxManifest: null, typePackages, version: '0.1.1-rc.2' })
  assert.equal(missing.length, 1)
  assert.match(missing[0]!.fix, /build:dsh/)
})

test('conflict report renders parseable JSON with the documented shape', () => {
  const report = renderConflictReport([{
    step: 'lock',
    expected: 'scripts/dsh-runtime-9.9.9-test-lock.yaml present',
    actual: 'missing',
    file: 'scripts/dsh-runtime-9.9.9-test-lock.yaml',
    fix: 'copy pnpm-lock.yaml out of the pinned tarball assembly',
  }])
  const parsed: unknown = JSON.parse(report)
  assert.ok(Array.isArray(parsed))
  const entry = (parsed as { step?: string }[])[0]!
  assert.equal(entry.step, 'lock')
})
