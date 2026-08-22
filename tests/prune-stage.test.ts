import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, existsSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pruneRuntimeDependencies, dietNodeRuntime, writeDesktopNodeBridge } from '../scripts/prune-stage.mjs'

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

function makeRuntimeTree(root: string): void {
  // Unreferenced declaration + dev payload on a plain package.
  writeFile(join(root, 'node_modules', 'pkg-plain', 'package.json'), JSON.stringify({
    name: 'pkg-plain', version: '1.0.0', main: './lib/real.js',
    exports: { '.': { default: './lib/real.js' } },
  }))
  writeFile(join(root, 'node_modules', 'pkg-plain', 'index.js'), 'module.exports = 1\n')
  writeFile(join(root, 'node_modules', 'pkg-plain', 'index.js.map'), '{"version":3}\n')
  writeFile(join(root, 'node_modules', 'pkg-plain', 'index.d.ts'), 'export declare const a: number\n')
  writeFile(join(root, 'node_modules', 'pkg-plain', 'src', 'index.ts'), 'export const a = 1\n')
  writeFile(join(root, 'node_modules', 'pkg-plain', 'test', 'case.test.js'), 'test()\n')
  writeFile(join(root, 'node_modules', 'pkg-plain', '.yarn', 'plugin.cjs'), 'module.exports = {}\n')
  writeFile(join(root, 'node_modules', 'pkg-plain', 'lib', 'real.js'), 'module.exports = 2\n')

  // `src` reachable through a runtime default condition: must be preserved.
  writeFile(join(root, 'node_modules', 'pkg-src-runtime', 'package.json'), JSON.stringify({
    name: 'pkg-src-runtime', version: '1.0.0',
    exports: { '.': { default: './src/index.js' } },
  }))
  writeFile(join(root, 'node_modules', 'pkg-src-runtime', 'src', 'index.js'), 'module.exports = 3\n')

  // `src` only under the build-only "source" condition: must be stripped.
  writeFile(join(root, 'node_modules', 'pkg-src-buildonly', 'package.json'), JSON.stringify({
    name: 'pkg-src-buildonly', version: '1.0.0',
    exports: { '.': { source: './src/index.ts', default: './lib/index.js' } },
  }))
  writeFile(join(root, 'node_modules', 'pkg-src-buildonly', 'src', 'index.ts'), 'export const x = 1\n')
  writeFile(join(root, 'node_modules', 'pkg-src-buildonly', 'lib', 'index.js'), 'module.exports = 4\n')

  // Build variants: esm/esnext not reachable from Node conditions (module
  // field is bundler-only); a reachable `import` condition must be kept.
  writeFile(join(root, 'node_modules', 'pkg-variants', 'package.json'), JSON.stringify({
    name: 'pkg-variants', version: '1.0.0',
    main: './index.js',
    module: './esm/index.js',
    exports: {
      '.': {
        import: './esm/index.mjs',
        require: './cjs/index.cjs',
        default: './index.js',
      },
    },
  }))
  writeFile(join(root, 'node_modules', 'pkg-variants', 'esm', 'index.mjs'), 'export default 1\n')
  writeFile(join(root, 'node_modules', 'pkg-variants', 'esnext', 'index.mjs'), 'export default 1\n')
  writeFile(join(root, 'node_modules', 'pkg-variants', 'cjs', 'index.cjs'), 'module.exports = 1\n')
  writeFile(join(root, 'node_modules', 'pkg-variants', 'es6', 'index.js'), 'module.exports = 1\n')

  // Legacy package without exports: main requires ./src internally, so src
  // must be preserved (protobufjs shape).
  writeFile(join(root, 'node_modules', 'pkg-legacy', 'package.json'), JSON.stringify({
    name: 'pkg-legacy', version: '7.6.5', main: './index.js',
  }))
  writeFile(join(root, 'node_modules', 'pkg-legacy', 'index.js'), "module.exports = require('./src/index')\n")
  writeFile(join(root, 'node_modules', 'pkg-legacy', 'src', 'index.js'), 'module.exports = 1\n')

  // OTel-style exports: only default condition -> Node falls back to src;
  // esm/esnext are dead. semantic-conventions shape.
  writeFile(join(root, 'node_modules', 'pkg-otel', 'package.json'), JSON.stringify({
    name: 'pkg-otel', version: '1.0.0',
    exports: {
      '.': {
        esnext: './build/esnext/index.js',
        module: './build/esm/index.js',
        types: './build/src/index.d.ts',
        default: './build/src/index.js',
      },
    },
  }))
  writeFile(join(root, 'node_modules', 'pkg-otel', 'build', 'esm', 'index.js'), 'module.exports = 1\n')
  writeFile(join(root, 'node_modules', 'pkg-otel', 'build', 'esnext', 'index.js'), 'module.exports = 1\n')
  writeFile(join(root, 'node_modules', 'pkg-otel', 'build', 'src', 'index.js'), 'module.exports = 1\n')

  // Shared dependency store: one entry linked from a package, one orphaned.
  const store = join(root, 'node_modules', '.dsh-studio-store')
  writeFile(join(store, 'entry_keep', 'node_modules', 'pkg-keep', 'package.json'), JSON.stringify({
    name: 'pkg-keep', version: '1.0.0', main: './index.js',
  }))
  writeFile(join(store, 'entry_keep', 'node_modules', 'pkg-keep', 'index.js'), 'module.exports = 5\n')
  writeFile(join(store, 'entry_orphan', 'node_modules', 'pkg-orphan', 'package.json'), JSON.stringify({
    name: 'pkg-orphan', version: '1.0.0', main: './index.js',
  }))
  writeFile(join(store, 'entry_orphan', 'node_modules', 'pkg-orphan', 'index.js'), 'module.exports = 7\n')
  mkdirSync(join(root, 'node_modules', 'consumer', 'node_modules'), { recursive: true })
  symlinkSync('../../.dsh-studio-store/entry_keep/node_modules/pkg-keep',
    join(root, 'node_modules', 'consumer', 'node_modules', 'pkg-keep'))
}

test('pruneRuntimeDependencies strips unreachable payload and keeps maps + reachable builds', () => {
  const root = mkdtempSync(join(tmpdir(), 'prune-runtime-'))
  try {
    makeRuntimeTree(root)
    const stats = pruneRuntimeDependencies(root)
    const nm = join(root, 'node_modules')

    assert.ok(existsSync(join(nm, 'pkg-plain', 'index.js.map')), 'source maps survive')
    assert.ok(!existsSync(join(nm, 'pkg-plain', 'index.d.ts')), 'declarations removed')
    assert.ok(!existsSync(join(nm, 'pkg-plain', 'src')), 'unreferenced src removed')
    assert.ok(!existsSync(join(nm, 'pkg-plain', 'test')), 'dev dir removed')
    assert.ok(!existsSync(join(nm, 'pkg-plain', '.yarn')))
    assert.ok(existsSync(join(nm, 'pkg-plain', 'lib', 'real.js')))

    assert.ok(existsSync(join(nm, 'pkg-src-runtime', 'src', 'index.js')), 'runtime-reachable src kept')
    assert.ok(!existsSync(join(nm, 'pkg-src-buildonly', 'src')), 'build-only src stripped')
    assert.ok(existsSync(join(nm, 'pkg-src-buildonly', 'lib', 'index.js')))

    // pkg-variants: root-level variant dirs are internal-require candidates
    // and survive; esm/cjs are exports-reachable and survive.
    assert.ok(existsSync(join(nm, 'pkg-variants', 'esm', 'index.mjs')), 'import-condition esm kept')
    assert.ok(existsSync(join(nm, 'pkg-variants', 'cjs', 'index.cjs')), 'require-condition cjs kept')
    assert.ok(existsSync(join(nm, 'pkg-variants', 'esnext')), 'root-level esnext kept (conservative)')
    assert.ok(existsSync(join(nm, 'pkg-variants', 'es6')), 'root-level es6 kept (conservative)')

    // pkg-otel: build/src reachable via default; build/esm + build/esnext are
    // sibling alias copies under the referenced build dir -> stripped.
    assert.ok(existsSync(join(nm, 'pkg-otel', 'build', 'src', 'index.js')))
    assert.ok(!existsSync(join(nm, 'pkg-otel', 'build', 'esm')), 'unreferenced esm stripped')
    assert.ok(!existsSync(join(nm, 'pkg-otel', 'build', 'esnext')), 'unreferenced esnext stripped')

    // pkg-legacy: no exports map, main requires ./src internally -> keep src.
    assert.ok(existsSync(join(nm, 'pkg-legacy', 'src', 'index.js')), 'legacy src preserved')

    const store = join(nm, '.dsh-studio-store')
    assert.ok(existsSync(join(store, 'entry_keep')))
    assert.ok(!existsSync(join(store, 'entry_orphan')), 'orphaned store entry swept')
    assert.equal(stats.storeEntriesRemoved, 1)
    assert.ok(stats.declarationFiles >= 1)
    assert.ok(stats.variantBytes > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('dietNodeRuntime removes compile payload and keeps bin/node + pnpm', () => {
  const root = mkdtempSync(join(tmpdir(), 'prune-node-'))
  try {
    writeFile(join(root, 'include', 'node', 'node.h'), '// header\n')
    writeFile(join(root, 'lib', 'node_modules', 'npm', 'index.js'), '// npm\n')
    writeFile(join(root, 'share', 'doc', 'x.txt'), 'x\n')
    writeFile(join(root, 'CHANGELOG.md'), 'changelog\n')
    writeFile(join(root, 'README.md'), 'readme\n')
    writeFile(join(root, 'bin', 'npm'), '#!/usr/bin/env node\n')
    chmodSync(join(root, 'bin', 'npm'), 0o755)
    writeFile(join(root, 'lib', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'), '// pnpm launcher\n')
    symlinkSync('../lib/node_modules/pnpm/bin/pnpm.mjs', join(root, 'bin', 'pnpm'))
    writeFile(join(root, 'bin', 'node'), 'real node binary\n')
    chmodSync(join(root, 'bin', 'node'), 0o755)

    const stats = dietNodeRuntime(root)
    assert.ok(!existsSync(join(root, 'include')))
    assert.ok(!existsSync(join(root, 'lib', 'node_modules', 'npm')))
    assert.ok(!existsSync(join(root, 'share')))
    assert.ok(!existsSync(join(root, 'CHANGELOG.md')))
    assert.ok(!existsSync(join(root, 'bin', 'npm')))
    assert.ok(existsSync(join(root, 'bin', 'node')), 'standalone node binary survives')
    assert.ok(existsSync(join(root, 'bin', 'pnpm')), 'pnpm launcher survives')
    assert.ok(stats.nodeDietBytes > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('writeDesktopNodeBridge replaces the binary with an Electron bridge', () => {
  const root = mkdtempSync(join(tmpdir(), 'prune-bridge-'))
  try {
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(join(root, 'bin', 'node'), 'real node binary')
    chmodSync(join(root, 'bin', 'node'), 0o755)
    const replaced = writeDesktopNodeBridge(root, '$(dirname "$0")/../../../MacOS/DSH Studio')
    assert.equal(replaced, true)
    const bridge = readFileSync(join(root, 'bin', 'node'), 'utf8')
    assert.match(bridge, /ELECTRON_RUN_AS_NODE=1/)
    assert.match(bridge, /MacOS\/DSH Studio/)
    assert.ok(!bridge.includes('real node binary'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
