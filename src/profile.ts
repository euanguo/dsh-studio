import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Profile name reserved for the packaged desktop surface. */
export const DESKTOP_PROFILE = 'desktop'

/** Plugins that enroll a browser-side entry in the desktop client graph. */
export const BUNDLED_DESKTOP_CLIENT_PLUGINS = [
  '@oh-dsh/desktop',
  '@oh-dsh/desktop-left-rail',
  '@oh-dsh/desktop-skins',
  '@oh-dsh/desktop-sidebar',
  '@oh-dsh/panel-controls',
  '@oh-dsh/pinned-summary',
  '@oh-dsh/plugin-marketplace',
] as const

/** Host-only capability providers shipped inside the desktop runtime. */
export const BUNDLED_DESKTOP_HOST_PLUGINS = [
  '@oh-dsh/better-sidebar-runtime',
] as const

/** Every protected plugin shipped inside the desktop distribution. */
export const BUNDLED_DESKTOP_PLUGINS = [
  ...BUNDLED_DESKTOP_CLIENT_PLUGINS,
  ...BUNDLED_DESKTOP_HOST_PLUGINS,
] as const

/** Bundle order owned by the desktop distribution. */
export const DESKTOP_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@oh-dsh/desktop',
] as const

interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
  [key: string]: unknown
}

/** Paths created for one desktop profile. */
export interface DesktopProfilePaths {
  dshHome: string
  profileDir: string
}

const ROOT_CONFIG = `# Oh-DSH-Desktop profile root. Composition lives in bundle patch layers.\n[]\n`
const USER_PATCH = `# User patch layer for Oh-DSH-Desktop. It is applied after the packaged bundles.\n[]\n`
const PNPM_WORKSPACE = `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n`

function readManifest(path: string): ProfileManifest {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`desktop profile manifest ${path} must contain an object`)
  }
  return parsed as ProfileManifest
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.desktop-tmp-${String(process.pid)}`
  writeFileSync(temporary, JSON.stringify(value, undefined, 2) + '\n', { mode: 0o600 })
  renameSync(temporary, path)
}

function requiredBundles(existing: readonly string[]): string[] {
  const required = new Set<string>(DESKTOP_BUNDLES)
  return [...DESKTOP_BUNDLES, ...existing.filter(bundle => !required.has(bundle))]
}

/**
 * Initialize or upgrade the writable desktop profile without replacing user
 * patches or third-party bundle entries.
 * @param dshHome - application-owned DSH home directory.
 * @returns resolved profile paths.
 */
export function ensureDesktopProfile(dshHome: string): DesktopProfilePaths {
  const profileDir = join(dshHome, 'profiles', DESKTOP_PROFILE)
  mkdirSync(profileDir, { recursive: true, mode: 0o700 })
  const manifestPath = join(profileDir, 'package.json')
  const manifest = existsSync(manifestPath)
    ? readManifest(manifestPath)
    : { name: 'dsh-profile-desktop', private: true, dependencies: {} }
  const currentBundles = manifest.dsh?.profile?.bundles ?? []
  const next: ProfileManifest = {
    ...manifest,
    name: manifest.name ?? 'dsh-profile-desktop',
    private: true,
    dependencies: manifest.dependencies ?? {},
    dsh: {
      ...manifest.dsh,
      profile: {
        ...manifest.dsh?.profile,
        bundles: requiredBundles(currentBundles),
      },
    },
  }
  if (!existsSync(manifestPath) || JSON.stringify(next) !== JSON.stringify(manifest)) {
    writeJsonAtomic(manifestPath, next)
  }

  const defaults: ReadonlyArray<readonly [string, string]> = [
    ['cordis.yml', ROOT_CONFIG],
    ['cordis.patch.yml', USER_PATCH],
    ['pnpm-workspace.yaml', PNPM_WORKSPACE],
  ]
  for (const [name, contents] of defaults) {
    const path = join(profileDir, name)
    if (!existsSync(path)) writeFileSync(path, contents, { mode: 0o600 })
  }
  mkdirSync(dirname(join(dshHome, 'sessions', '.keep')), { recursive: true, mode: 0o700 })
  return { dshHome, profileDir }
}
