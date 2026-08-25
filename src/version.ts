/** Resolve the DSH Studio product version from the nearest reachable Git tag. */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Version fallback when no injected tag, reachable tag, or manifest is found. */
export const UNKNOWN_VERSION = '0.0.0'

declare const __DSH_STUDIO_BUILD_VERSION__: string | undefined

function injectedVersion(): string | undefined {
  return typeof __DSH_STUDIO_BUILD_VERSION__ === 'string'
    ? __DSH_STUDIO_BUILD_VERSION__
    : undefined
}

/** Normalize a release tag to the semver displayed by every DSH Studio surface. */
export function normalizeVersionTag(tag: string): string | undefined {
  const value = tag.trim()
  const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(value)
  return match?.[1]
}

/** Find the nearest release tag reachable from the current commit. */
export function nearestVersionTag(root: string): string | undefined {
  const result = spawnSync('git', [
    '-C', root,
    'describe',
    '--tags',
    '--abbrev=0',
    '--match', 'v[0-9]*',
    '--match', '[0-9]*',
    'HEAD',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.error !== undefined || result.status !== 0) return undefined
  return normalizeVersionTag(result.stdout)
}

function manifestVersion(root: string): string | undefined {
  for (const path of [
    join(root, 'package.json'),
    join(root, 'lib', 'dsh-studio', 'package.json'),
  ]) {
    try {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
      if (typeof manifest.version !== 'string') continue
      const version = normalizeVersionTag(manifest.version)
      if (version !== undefined) return version
    } catch {
      // Try the next supported distribution layout.
    }
  }
  return undefined
}

/**
 * Resolve one product version for Desktop, Web, and TUI.
 *
 * Builds inject the nearest tag so packaged applications do not need Git.
 * Source launches calculate it directly. Package metadata is only a fallback
 * for source archives produced without the repository history.
 */
export function resolveProductVersion(root: string): string {
  return injectedVersion()
    ?? nearestVersionTag(root)
    ?? manifestVersion(root)
    ?? UNKNOWN_VERSION
}
