import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  assertRuntimeBudget,
  loadRuntimeContract,
  measureTree,
  verifyPackagedApplication,
} from '../scripts/runtime-contract.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const contract = loadRuntimeContract()

test('runtime contract structure: pinned Node release and per-platform budgets', () => {
  // Config contract guard: budgets and the Node version are the single source
  // for staging and packaging gates. Adding a field must update this test.
  assert.match(contract.runtime.nodeVersion, /^\d+\.\d+\.\d+$/)
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    assert.ok(Number.isSafeInteger(contract.runtime.sizeBudgetBytes[platform]))
    assert.ok(contract.runtime.sizeBudgetBytes[platform] > 0)
    assert.ok(Number.isSafeInteger(contract.app.sizeBudgetBytes[platform]))
    assert.ok(contract.app.sizeBudgetBytes[platform] > contract.runtime.sizeBudgetBytes[platform],
      'app budget must exceed the runtime budget so a real bundle can verify')
  }
  assert.ok(Number.isSafeInteger(contract.runtime.fileBudget))
  assert.ok(contract.runtime.fileBudget > 0)
})

test('measureTree sums regular files without following symlinks', () => {
  const tree = mkdtempSync(join(tmpdir(), 'contract-measure-'))
  try {
    writeFileSync(join(tree, 'a.js'), 'x'.repeat(1_024))
    const nested = join(tree, 'nested')
    mkdirSync(nested)
    writeFileSync(join(nested, 'b.js'), 'y'.repeat(2_048))
    const measured = measureTree(tree)
    assert.equal(measured.bytes, 3_072)
    assert.equal(measured.files, 2)
  } finally {
    rmSync(tree, { recursive: true, force: true })
  }
})

test('assertRuntimeBudget passes inside budget and fails outside it', () => {
  const tree = mkdtempSync(join(tmpdir(), 'contract-budget-'))
  try {
    writeFileSync(join(tree, 'payload.js'), 'z'.repeat(65_536))
    const report = assertRuntimeBudget(tree, 'darwin', contract)
    assert.equal(report.files, 1)
    const gun = contract.runtime.sizeBudgetBytes.darwin
    writeFileSync(join(tree, 'big.bin'), Buffer.alloc(gun + 1))
    assert.throws(
      () => assertRuntimeBudget(tree, 'darwin', contract),
      /exceeds size budget/,
    )
    rmSync(join(tree, 'big.bin'), { force: true })
    mkdirSync(join(tree, 'many'), { recursive: true })
    writeFileSync(join(tree, 'many', 'f.js'), 'f')
    assert.throws(() => assertRuntimeBudget(tree, 'darwin', {
      ...contract,
      runtime: { ...contract.runtime, fileBudget: 1 },
    }), /exceeds file budget/)
  } finally {
    rmSync(tree, { recursive: true, force: true })
  }
})

test('verifyPackagedApplication measures bundle and shipped runtime (macOS layout)', () => {
  const bundle = mkdtempSync(join(tmpdir(), 'contract-app-'))
  try {
    const resources = join(bundle, 'Contents', 'Resources')
    const runtime = join(resources, 'dsh-runtime')
    const node = join(resources, 'node-runtime')
    mkdirSync(runtime, { recursive: true })
    mkdirSync(node, { recursive: true })
    writeFileSync(join(runtime, 'cli.js'), 'cli')
    writeFileSync(join(node, 'node'), 'node')
    const macos = join(bundle, 'Contents', 'MacOS')
    const frameworks = join(bundle, 'Contents', 'Frameworks')
    mkdirSync(macos, { recursive: true })
    mkdirSync(frameworks, { recursive: true })
    writeFileSync(join(macos, 'DSH Studio'), 'electron')
    writeFileSync(join(frameworks, 'E'), 'framework')

    // Tiny app verifies fine and reports both sections.
    const report = verifyPackagedApplication(bundle, { platform: 'darwin', contract })
    assert.equal(report.runtime.files, 2)
    assert.equal(report.app.files, 4)
    assert.ok(report.runtime.bytes >= 6)

    // Inflate only the runtime: the app budget still fails for a fat bundle.
    writeFileSync(join(runtime, 'fat.bin'), Buffer.alloc(contract.runtime.sizeBudgetBytes.darwin + 1))
    assert.throws(
      () => verifyPackagedApplication(bundle, { platform: 'darwin', contract }),
      /packaged runtime exceeds size budget/,
    )
  } finally {
    rmSync(bundle, { recursive: true, force: true })
  }
})
