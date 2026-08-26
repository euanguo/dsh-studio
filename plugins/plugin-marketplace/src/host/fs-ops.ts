// Low-level filesystem surgery shared by the marketplace host modules.
// Everything here is pure mechanics: containment guards, attribute-aware
// tree removal, profile copies, and portability assertions. Phase policy
// lives in transaction-manager.ts; state semantics live in state-file.ts.
import { errorMessage } from '@dsh-studio/shared/errors'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/** Canonical error text for every module in the marketplace host. */
export function message(error: unknown): string {
  return errorMessage(error)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function defaultWarn(message_: string): void {
  console.warn(`plugin-marketplace: ${message_}`)
}

export function ensureWithin(parent: string, candidate: string): void {
  const root = resolve(parent)
  const target = resolve(candidate)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`refusing filesystem operation outside ${root}: ${target}`)
  }
}

/**
 * Windows maps the read-only attribute to the owner write bit. Git packs and
 * some cloned files are created read-only, so `rmSync` fails with EPERM before
 * it can recurse into the tree. Clear that attribute before the retry while
 * never following symlinks out of the disposable tree.
 */
function clearReadOnlyAttributes(
  path: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') return
  try {
    const stats = lstatSync(path)
    if (stats.isDirectory()) {
      chmodSync(path, stats.mode | 0o200)
      for (const entry of readdirSync(path)) {
        clearReadOnlyAttributes(join(path, entry), platform)
      }
    } else if (stats.isFile()) {
      chmodSync(path, stats.mode | 0o200)
    }
  } catch {
    // Best-effort attribute pass; the removal retry below reports the real failure.
  }
}

function removeTree(
  path: string,
  onWarn: (message_: string) => void = defaultWarn,
  platform: NodeJS.Platform = process.platform,
): void {
  try {
    rmSync(path, { force: true, recursive: true })
    return
  } catch {
    if (platform === 'win32') clearReadOnlyAttributes(path, platform)
  }
  try {
    rmSync(path, { force: true, recursive: true })
  } catch (error) {
    onWarn(`failed to clean plugin marketplace tree at ${path}: ${message(error)}`)
  }
}

export function removeWithin(
  parent: string,
  candidate: string,
  onWarn: (message_: string) => void = defaultWarn,
  platform: NodeJS.Platform = process.platform,
): void {
  ensureWithin(parent, candidate)
  removeTree(candidate, onWarn, platform)
}

export function copyDirectory(source: string, target: string): void {
  if (!existsSync(source)) throw new Error(`source profile does not exist: ${source}`)
  if (existsSync(target)) throw new Error(`candidate profile already exists: ${target}`)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  cpSync(source, target, {
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true,
  })
}

export function assertBundleEntryFiles(checkout: string, targets: readonly string[]): void {
  const canonicalCheckout = realpathSync(checkout)
  for (const target of targets) {
    const entry = resolve(checkout, target)
    ensureWithin(checkout, entry)
    if (!existsSync(entry)) {
      throw new Error(`bundle entry ${target} was not materialized in the exact checkout`)
    }
    if (!lstatSync(entry).isFile()) {
      throw new Error(`bundle entry ${target} is not a regular file in the exact checkout`)
    }
    ensureWithin(canonicalCheckout, realpathSync(entry))
  }
}

export function assertPortableBundleProfile(profileDir: string, previewRoot: string): void {
  for (const name of ['package.json', 'pnpm-lock.yaml']) {
    const path = join(profileDir, name)
    if (existsSync(path) && readFileSync(path, 'utf8').includes(previewRoot)) {
      throw new Error(`${name} retained an absolute path into the disposable preview`)
    }
  }
}
