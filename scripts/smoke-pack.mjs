/**
 * Packed-artifact mount smoke (CI gate): `pnpm pack` the workspace, install
 * the TARBALL into a scratch desktop profile (`dsh plugin add <tarball>`),
 * boot the staged DSH runtime whose node_modules carries every @dsh-studio
 * package EXCEPT the packed one (the profile install is the only source of
 * `@dsh-studio/desktop`), then assert — on the SERVED page, not the local tree:
 *
 *   1. the client boot graph enrolls every DSH Studio bundle and the enrolled
 *      inject list matches the PACKED manifest (read from the profile
 *      install, i.e. the tarball content);
 *   2. each client bundle serves and enrolls its module id, and the
 *      sidebar bundle carries the migrated built-in registrations
 *      (bottom-workbench / subagent / tab-strip-wheel) — the "mount +
 *      no crash" granularity this repo's smokes use;
 *   3. the packed HOST answers `/sidebar/api/settings.get` (the host
 *      mounted from the tarball);
 *   4. a real Electron render (scripts/smoke-pack-client.cjs) sees the
 *      sidebar root mount with no plugin-load error bar.
 *
 * Mirrors the upstream e2e-mount.sh idea (npm pack → scratch profile →
 * headless render) at the granularity the repository's existing smokes
 * (smoke-runtime.mjs / smoke-web.mjs) already use.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronBinary from 'electron'
import { bundledRuntimePaths, runtimeSearchPath } from '../src/runtime-paths.ts'
import { ensureDesktopProfile } from '../src/profile.ts'
import { resolveDshSourceIfPresent, resolvePinnedPnpm } from './dsh-source.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resources = resolve(process.argv[2] ?? join(root, '.stage'))
const paths = bundledRuntimePaths(resources)
const { cliEntry, nodeBinary } = paths
const smokeRoot = mkdtempSync(join(tmpdir(), 'dsh-studio-pack-smoke-'))
const dshHome = join(smokeRoot, 'dsh-home')
const lines = []

/** The pnpm for packing: the pinned one when the DSH source checkout is
 *  present, otherwise the ambient pnpm. */
function packPnpm() {
  const source = resolveDshSourceIfPresent()
  if (source !== undefined) {
    try {
      const pinned = resolvePinnedPnpm(source)
      return process.platform === 'win32'
        ? join(pinned.binDir, 'pnpm.cmd')
        : join(pinned.binDir, 'pnpm')
    } catch {
      // Fall through to the ambient CLI.
    }
  }
  return 'pnpm'
}

function parseBootEntries(index) {
  const markers = [
    'globalThis["__DSH_BOOT__"] = ',
    'window.__DSH_BOOT__ = ',
  ]
  const marker = markers.find(candidate => index.includes(candidate))
  assert.notEqual(marker, undefined, 'DSH index did not contain a client boot graph')
  const start = index.indexOf(marker)
  const end = index.indexOf('</script>', start)
  assert.notEqual(end, -1, 'DSH client boot graph script was not closed')
  const graph = JSON.parse(index.slice(start + marker.length, end))
  assert.equal(typeof graph.rev, 'string')
  assert.ok(Array.isArray(graph.entries))
  return graph.entries
}

try {
  // 1. Pack the workspace into the scratch dir.
  const pack = spawnSync(packPnpm(), ['pack', '--pack-destination', smokeRoot], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(pack.status, 0, pack.stderr || pack.stdout)
  const tarball = (() => {
    const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
      .replace(/^@/, '').replace(/\//, '-')
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
    const path = join(smokeRoot, `${name}-${version}.tgz`)
    assert.ok(existsSync(path), `pnpm pack produced no tarball at ${path}`)
    return path
  })()

  // 2. Copy the staged runtime, dropping @dsh-studio/desktop: the profile's
  //    tarball install becomes its ONLY source (a hard-link copy keeps the
  //    691MB tree cheap on POSIX; fs.cpSync is the portable fallback). The
  //    staged runtime tree lives at `resources/dsh-runtime`.
  const runtimeCopy = join(smokeRoot, 'runtime')
  if (process.platform !== 'win32') {
    const copy = spawnSync('cp', ['-al', resources, runtimeCopy], { encoding: 'utf8' })
    assert.equal(copy.status, 0, copy.stderr || copy.stdout)
  } else {
    cpSync(resources, runtimeCopy, { recursive: true })
  }
  const runtimeTree = join(runtimeCopy, 'dsh-runtime')
  assert.ok(
    existsSync(join(runtimeTree, 'lib', 'bin.js')),
    `staged runtime copy is missing the CLI at ${join(runtimeTree, 'lib', 'bin.js')}`,
  )
  rmSync(join(runtimeTree, 'node_modules', '@dsh-studio', 'desktop'), {
    force: true,
    recursive: true,
  })

  // 3. Ensure the desktop profile (the full DSH Studio bundle set — the CLI's
  //    stock init omits dsh-web-app, which provides webServer) and install
  //    the PACKED tarball into it.
  ensureDesktopProfile(dshHome)
  const runtimeEnvironment = {
    ...process.env,
    DSH_STUDIO_DESKTOP: '1',
    DSH_STUDIO_DESKTOP_APP_DATA: smokeRoot,
    DSH_STUDIO_DESKTOP_PROFILE: 'desktop',
    DSH_STUDIO_DESKTOP_VERSION: 'smoke',
    DSH_HOME: dshHome,
    PATH: runtimeSearchPath(paths),
  }
  const install = spawnSync(nodeBinary, [
    cliEntry, 'plugin', '--profile', 'desktop', 'add', tarball,
  ], {
    cwd: smokeRoot,
    encoding: 'utf8',
    env: runtimeEnvironment,
  })
  assert.equal(install.status, 0, install.stderr || install.stdout)
  const profileManifest = JSON.parse(readFileSync(
    join(dshHome, 'profiles', 'desktop', 'package.json'),
    'utf8',
  ))
  assert.ok(
    profileManifest.dsh.profile.bundles.includes('@dsh-studio/desktop'),
    'desktop profile bundles do not include @dsh-studio/desktop',
  )
  // The profile install IS the tarball: its manifest is the packed artifact.
  const packedManifest = JSON.parse(readFileSync(join(
    dshHome,
    'profiles',
    'desktop',
    'node_modules',
    '@dsh-studio',
    'desktop',
    'package.json',
  ), 'utf8'))
  assert.equal(packedManifest.name, '@dsh-studio/desktop')

  // 4. Boot the desktop profile against the runtime COPY (its CLI; the
  //    node binary from the original stage is fine — not under test).
  const copyCliEntry = join(runtimeTree, 'lib', 'bin.js')
  const child = spawn(nodeBinary, [copyCliEntry, '--profile', 'desktop'], {
    cwd: smokeRoot,
    env: runtimeEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  function lineReader(stream, resolveReady) {
    let pending = ''
    return chunk => {
      pending += chunk.toString('utf8')
      for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
        const line = pending.slice(0, newline).replace(/\r$/, '')
        pending = pending.slice(newline + 1)
        lines.push(`[${stream}] ${line}`)
        const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/.exec(line)
        if (match?.[1] !== undefined) resolveReady(new URL(match[1]))
      }
    }
  }
  let readySettled = false
  const ready = new Promise((resolveReady, reject) => {
    const resolveOnce = value => {
      if (readySettled) return
      readySettled = true
      resolveReady(value)
    }
    child.stdout.on('data', lineReader('stdout', resolveOnce))
    child.stderr.on('data', lineReader('stderr', resolveOnce))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (readySettled) return
      reject(new Error(`runtime exited before readiness (code=${String(code)}, signal=${String(signal)})\n${lines.join('\n')}`))
    })
  })
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`runtime readiness timed out\n${lines.join('\n')}`)), 90_000).unref()
  })

  try {
    const base = await Promise.race([ready, timeout])
    const index = await (await fetch(base)).text()
    assert.match(index, /<div id="root"><\/div>/)
    const bootEntries = parseBootEntries(index)

    // 5. The packed bundle enrolls its browser entries, and the enrolled
    //    inject list matches its manifest — for @dsh-studio/desktop that is the
    //    PACKED manifest (the profile install is the tarball), for the
    //    peer bundles the runtime copy they resolved from.
    for (const pluginId of [
      '@dsh-studio/desktop',
      '@dsh-studio/sidebar',
      '@dsh-studio/sidebar-desktop',
      '@dsh-studio/panel-controls',
    ]) {
      const row = bootEntries.find(entry => entry.id === pluginId)
      assert.ok(row, `${pluginId} Host entry did not activate in the DSH client graph`)
      const manifestRoot = pluginId === '@dsh-studio/desktop'
        ? join(dshHome, 'profiles', 'desktop', 'node_modules')
        : join(runtimeTree, 'node_modules')
      const manifest = JSON.parse(readFileSync(join(
        manifestRoot,
        ...pluginId.split('/'),
        'package.json',
      ), 'utf8'))
      assert.deepEqual(row.inject ?? [], manifest.dsh.client.inject ?? [])
      assert.equal(row.immediately === true, manifest.dsh.client.immediately === true)
      const bundleResponse = await fetch(new URL(row.url, base))
      const bundle = await bundleResponse.text()
      assert.equal(bundleResponse.status, 200, `${pluginId} Client bundle returned ${String(bundleResponse.status)}`)
      assert.ok(bundle.includes(pluginId), `${pluginId} client bundle did not enroll its module id`)
    }

    // 6. The mounted sidebar bundle carries the migrated built-ins (the
    //    "built-in tabs mount" granularity: their registrations compiled
    //    into the served bundle).
    const sidebarRow = bootEntries.find(entry => entry.id === '@dsh-studio/sidebar')
    assert.ok(sidebarRow, 'sidebar row missing from the boot graph')
    const sidebarBundle = await (await fetch(new URL(sidebarRow.url, base))).text()
    for (const marker of ['bottom-workbench', 'subagent', 'tab-strip-wheel', 'selection-insert']) {
      assert.ok(sidebarBundle.includes(marker), `sidebar bundle is missing the "${marker}" built-in`)
    }

    // 7. The packed HOST mounted: the settings seam answers with the
    //    migrated preference vocabulary.
    const settingsResponse = await fetch(new URL('/sidebar/api/settings.get', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(settingsResponse.status, 200)
    const settingsBody = await settingsResponse.text()
    assert.ok(settingsBody.includes('"ok":true'), `settings.get failed: ${settingsBody.slice(0, 200)}`)
    assert.ok(settingsBody.includes('autoOpenSubagent'), 'settings.get misses the migrated vocabulary')

    // 8. A real Electron render sees the sidebar mount with no error bar.
    const client = spawnSync(electronBinary, [
      '--no-sandbox',
      join(root, 'scripts', 'smoke-pack-client.cjs'),
    ], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...runtimeEnvironment,
        DSH_SMOKE_RUNTIME_URL: base.href,
      },
      timeout: 60_000,
    })
    assert.equal(
      client.status,
      0,
      client.error?.message || client.stderr || client.stdout,
    )

    console.log(`packed artifact mounted: ${base.href}`)
  } finally {
    child.kill()
  }
} finally {
  rmSync(smokeRoot, { force: true, recursive: true })
}