import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/**
 * Plugin-inventory drift guard.
 *
 * The assembled plugin set lives in THREE places per surface, each with a
 * different job: the bundle patch (host graph inserts), the package's
 * dsh.client.inject list (browser preload/prefetch metadata), and
 * src/profile.ts's BUNDLED_* constants (what the launcher stages into the
 * runtime profile). They are maintained by hand, so drift is silent: a
 * plugin added to one list but not another ships half-registered — exactly
 * what happened after the desktop reconciliation dropped @dsh-studio/skins and
 * @dsh-studio/vision while the web/TUI patches kept referencing them. These
 * contracts pin the invariants that must hold for every surface:
 *
 * 1. Every @dsh-studio/* insert in a surface's patch resolves to a real plugin
 *    tree in this repository (the loader can never mount a ghost).
 * 2. Every @dsh-studio/* entry in a surface's client inject list is mounted by
 *    that surface's patch (the inject metadata never names an unmounted
 *    plugin).
 * 3. Desktop additionally: every patch insert is staged by the profile's
 *    BUNDLED constants, and every BUNDLED client plugin is reachable from
 *    some inject list.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>
}

function patchInserts(path: string): string[] {
  const text = readFileSync(join(root, path), 'utf8')
  return [...text.matchAll(/name:\s*'(@dsh-studio\/[a-z-]+)'/g)]
    .map(match => match[1]!)
    .sort()
}

function injectList(path: string): string[] {
  const pkg = readJson(path) as {
    dsh?: { client?: { inject?: string[] } }
  }
  return (pkg.dsh?.client?.inject ?? [])
    .filter(name => name.startsWith('@dsh-studio/'))
    .sort()
}

/** Resolve a plugin name through its literal constants (spreads included). */
function bundledConstant(name: string): string[] {
  const text = readFileSync(join(root, 'src', 'profile.ts'), 'utf8')
  const start = text.indexOf(`export const ${name} = [`)
  assert.notEqual(start, -1, `${name} exists in src/profile.ts`)
  const end = text.indexOf('] as const', start)
  const body = text.slice(start, end)
  const literals = [...body.matchAll(/'(@dsh-studio\/[a-z-]+)'/g)].map(match => match[1]!)
  // Follow spread references to sibling constants (one level).
  const spreads = [...body.matchAll(/\.\.\.([A-Z_]+),?/g)].map(match => match[1]!)
  for (const spread of spreads) {
    literals.push(...bundledConstant(spread))
  }
  return [...new Set(literals)].sort()
}

/** A plugin tree exists when its package.json AND host entry are on disk. */
function pluginTreeExists(name: string): boolean {
  const dir = join(root, 'plugins', name.replace('@dsh-studio/', ''))
  return existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src', 'index.ts'))
}

test('desktop: every patch insert resolves to a real plugin tree', () => {
  const missing = patchInserts('cordis.patch.yml').filter(name => {
    if (name === '@dsh-studio/desktop') return false // the root shell package (src/)
    return !pluginTreeExists(name)
  })
  assert.deepEqual(missing, [], 'desktop patch inserts without a plugin tree')
})

test('desktop: every patch insert is staged by the profile', () => {
  const inserts = patchInserts('cordis.patch.yml')
  const bundled = bundledConstant('BUNDLED_DESKTOP_PLUGINS')
  const missing = inserts.filter(name => !bundled.includes(name))
  assert.deepEqual(missing, [], 'patch inserts missing from BUNDLED_DESKTOP_PLUGINS')
})

test('desktop: inject metadata names only shipped client plugins', () => {
  const injected = injectList('package.json')
  const bundled = bundledConstant('BUNDLED_DESKTOP_CLIENT_PLUGINS')
  const allowed = [...bundled, '@dsh-studio/desktop']
  const unknown = injected.filter(name => !allowed.includes(name))
  assert.deepEqual(unknown, [], 'inject entries missing from BUNDLED_DESKTOP_CLIENT_PLUGINS')
})

test('desktop: every client plugin is reachable from some inject list', () => {
  const bundled = bundledConstant('BUNDLED_DESKTOP_CLIENT_PLUGINS')
  const injected = new Set(injectList('package.json'))
  // Client halves that enroll through another bundle's inject declaration
  // (they have no dsh.client block of their own).
  const shellCarried = new Set(['@dsh-studio/desktop', '@dsh-studio/desktop-left-rail', '@dsh-studio/desktop-skins'])
  const unreachable = bundled.filter(
    name => !injected.has(name) && !shellCarried.has(name),
  )
  assert.deepEqual(
    unreachable,
    [],
    'BUNDLED_DESKTOP_CLIENT_PLUGINS entries that no inject list can ever load',
  )
})

test('web: every patch insert resolves to a real plugin tree', () => {
  const missing = patchInserts('web/cordis.patch.yml').filter(name => {
    if (name === '@dsh-studio/web') return false // the shell itself lives in web/
    return !pluginTreeExists(name)
  })
  assert.deepEqual(missing, [], 'web patch inserts without a plugin tree')
})

test('web: inject metadata names only plugins the web patch mounts', () => {
  const injected = injectList('web/package.json')
  const inserts = patchInserts('web/cordis.patch.yml')
  const unknown = injected.filter(name => !inserts.includes(name))
  assert.deepEqual(unknown, [], 'web inject entries not mounted by the web patch')
})

test('tui: every patch insert resolves to a real plugin tree', () => {
  const missing = patchInserts('plugins/tui/cordis.patch.yml').filter(name => {
    if (name === 'dsh-cc-tui') return false // the upstream renderer package
    return !pluginTreeExists(name)
  })
  assert.deepEqual(missing, [], 'tui patch inserts without a plugin tree')
})

/* ---------- build & staging lists (inventory #4 and #5) ---------- */

/** The esbuild driver's pluginPackages array: directory names it builds. */
function buildDirectories(): string[] {
  const source = readFileSync(join(root, 'scripts', 'build.mjs'), 'utf8')
  return [...source.matchAll(/\{ directory: '([a-z-]+)'/g)].map(match => match[1]!)
}

/** The stage-dsh browser-plugin staging list: directory names it stages. */
function stageDirectories(): string[] {
  const source = readFileSync(join(root, 'scripts', 'stage-dsh.mjs'), 'utf8')
  const marker = '].map(directory => ({'
  const markerAt = source.indexOf(marker)
  assert.ok(markerAt > 0, 'stage-dsh browser-plugin list found')
  const start = source.lastIndexOf('...[', markerAt)
  const body = source.slice(start, markerAt)
  return [...body.matchAll(/'([a-z-]+)'/g)].map(match => match[1]!)
}

test('build script compiles every browser plugin the patches can mount', () => {
  const built = new Set(buildDirectories())
  const mounted = new Set([
    ...patchInserts('cordis.patch.yml'),
    ...patchInserts('web/cordis.patch.yml'),
    ...patchInserts('plugins/tui/cordis.patch.yml').filter(name => name.startsWith('@dsh-studio/')),
  ])
  // The root shell packages build through their own esbuild entries, not
  // the pluginPackages loop.
  mounted.delete('@dsh-studio/desktop')
  mounted.delete('@dsh-studio/web')
  const missing = [...mounted].filter(name => !built.has(name.replace('@dsh-studio/', '')))
  assert.deepEqual(
    missing,
    [],
    'patch-mounted plugins without a build.mjs entry (no dist output — runtime load failure)',
  )
})

test('stage script ships every desktop browser plugin the profile bundles', () => {
  const staged = new Set(stageDirectories())
  const bundled = bundledConstant('BUNDLED_DESKTOP_CLIENT_PLUGINS')
  // sidebar-host (host-only) and the shell package stage through their own
  // dedicated file blocks in stage-dsh.mjs.
  const shellOrHost = new Set(['@dsh-studio/desktop', '@dsh-studio/sidebar-host'])
  const missing = bundled.filter(
    name => !shellOrHost.has(name) && !staged.has(name.replace('@dsh-studio/', '')),
  )
  assert.deepEqual(
    missing,
    [],
    'BUNDLED_DESKTOP_CLIENT_PLUGINS entries the stage script never ships',
  )
})
