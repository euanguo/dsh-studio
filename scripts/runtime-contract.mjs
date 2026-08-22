/**
 * Runtime contract: the single source of truth for the pinned Node release
 * and the size budgets that gate staging and packaging.
 *
 * The staged/packaged tree may only grow inside the documented budgets; when
 * a budget is exceeded the build fails loudly instead of silently shipping a
 * fatter artifact (modeled after Minke's harness-runtime.json gates).
 *
 * Structure guard: tests/runtime-contract.test.ts validates every field
 * structurally, so adding a field requires updating the test.
 */

import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Signed, frozen copy of config/runtime-contract.json. */
export function loadRuntimeContract(contractPath = join(root, 'config', 'runtime-contract.json')) {
  const parsed = JSON.parse(readFileSync(contractPath, 'utf8'))
  if (parsed.schemaVersion !== 1) {
    throw new Error(`runtime contract schema ${String(parsed.schemaVersion)} is unsupported`)
  }
  const runtime = parsed.runtime
  const app = parsed.app
  if (
    runtime === null || typeof runtime !== 'object'
    || app === null || typeof app !== 'object'
  ) {
    throw new Error('runtime contract must define runtime and app sections')
  }
  if (typeof runtime.nodeVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(runtime.nodeVersion)) {
    throw new Error('runtime.nodeVersion must be a semver string')
  }
  for (const platform of ['darwin', 'linux', 'win32']) {
    if (!Number.isSafeInteger(runtime.sizeBudgetBytes?.[platform]) || runtime.sizeBudgetBytes[platform] <= 0) {
      throw new Error(`runtime.sizeBudgetBytes.${platform} must be a positive integer`)
    }
    if (!Number.isSafeInteger(app.sizeBudgetBytes?.[platform]) || app.sizeBudgetBytes[platform] <= 0) {
      throw new Error(`app.sizeBudgetBytes.${platform} must be a positive integer`)
    }
  }
  if (!Number.isSafeInteger(runtime.fileBudget) || runtime.fileBudget <= 0) {
    throw new Error('runtime.fileBudget must be a positive integer')
  }
  return Object.freeze({
    runtime: Object.freeze({
      nodeVersion: runtime.nodeVersion,
      sizeBudgetBytes: Object.freeze({ ...runtime.sizeBudgetBytes }),
      fileBudget: runtime.fileBudget,
    }),
    app: Object.freeze({
      sizeBudgetBytes: Object.freeze({ ...app.sizeBudgetBytes }),
    }),
  })
}

/** Sum of regular-file bytes and count, never following symlinks. */
export function measureTree(rootPath) {
  let bytes = 0
  let files = 0
  const visit = directory => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) continue
      try {
        bytes += lstatSync(path).size
      } catch {
        continue
      }
      files += 1
    }
  }
  visit(rootPath)
  return { bytes, files }
}

/** Assert one runtime tree against the contract budgets for a platform. */
export function assertRuntimeBudget(runtimeRoot, platform, contract = loadRuntimeContract()) {
  const budget = contract.runtime.sizeBudgetBytes[platform]
  const fileBudget = contract.runtime.fileBudget
  const { bytes, files } = measureTree(runtimeRoot)
  const report = { bytes, files, path: resolve(runtimeRoot) }
  if (bytes > budget) {
    throw new Error(
      `staged runtime exceeds size budget: ${(bytes / 1048576).toFixed(1)} MiB `
      + `(${String(files)} files) > ${(budget / 1048576).toFixed(1)} MiB at ${report.path}`,
    )
  }
  if (files > fileBudget) {
    throw new Error(
      `staged runtime exceeds file budget: ${String(files)} files > ${String(fileBudget)} at ${report.path}`,
    )
  }
  return report
}

/**
 * Verify one packaged application bundle (macOS .app, linux-unpacked,
 * win-unpacked): the shipped runtime must fit the runtime budgets and the
 * whole bundle the app budget. Throws when either is exceeded.
 */
export function verifyPackagedApplication(packageRoot, { platform, contract = loadRuntimeContract() }) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(`unsupported packaging platform: ${platform}`)
  }
  const bundle = measureTree(packageRoot)
  const appBudget = contract.app.sizeBudgetBytes[platform]
  if (bundle.bytes > appBudget) {
    throw new Error(
      `packaged app exceeds size budget: ${(bundle.bytes / 1048576).toFixed(1)} MiB `
      + `(${String(bundle.files)} files) > ${(appBudget / 1048576).toFixed(1)} MiB at ${resolve(packageRoot)}`,
    )
  }
  const resourcesRoot = platform === 'darwin'
    ? join(packageRoot, 'Contents', 'Resources')
    : join(packageRoot, 'resources')
  const runtimeRoots = ['dsh-runtime', 'node-runtime']
    .map(name => join(resourcesRoot, name))
    .filter(path => {
      try {
        return lstatSync(path).isDirectory()
      } catch {
        return false
      }
    })
  const runtime = runtimeRoots.reduce(
    (total, path) => {
      const measured = measureTree(path)
      return { bytes: total.bytes + measured.bytes, files: total.files + measured.files }
    },
    { bytes: 0, files: 0 },
  )
  if (runtime.bytes > contract.runtime.sizeBudgetBytes[platform]) {
    throw new Error(
      `packaged runtime exceeds size budget: ${(runtime.bytes / 1048576).toFixed(1)} MiB `
      + `> ${(contract.runtime.sizeBudgetBytes[platform] / 1048576).toFixed(1)} MiB`,
    )
  }
  if (runtime.files > contract.runtime.fileBudget) {
    throw new Error(
      `packaged runtime exceeds file budget: ${String(runtime.files)} files > ${String(contract.runtime.fileBudget)}`,
    )
  }
  return {
    app: { bytes: bundle.bytes, files: bundle.files },
    runtime: { bytes: runtime.bytes, files: runtime.files },
  }
}
