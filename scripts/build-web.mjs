import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { portableZipArguments } from '../src/archive.ts'
import { resolveProductVersion } from '../src/version.ts'
import { resolveNodeDistributionPlatform } from '../src/node-platform.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const stage = join(root, '.stage')
const release = join(root, 'release')
const version = resolveProductVersion(root)
const platform = resolveNodeDistributionPlatform()
const arch = process.env.DSH_STUDIO_NODE_ARCH ?? process.arch
const isWindowsHost = process.platform === 'win32'
const isWindowsTarget = platform === 'win'
const stagedNode = join(stage, 'node-runtime', isWindowsTarget ? 'node.exe' : join('bin', 'node'))
const dirName = `dsh-studio-web-${version}-${platform}-${arch}`
const packageDir = join(release, dirName)

for (const required of [
  join(root, 'dist', 'web.js'),
  join(root, 'dist', 'dsh-studio.js'),
  join(stage, 'dsh-runtime', 'lib', 'bin.js'),
  stagedNode,
  join(stage, 'dsh-runtime', 'node_modules', '@dsh-studio', 'web', 'dist', 'index.js'),
  join(stage, 'dsh-runtime', 'node_modules', '@dsh-studio', 'web', 'dist', 'cordis.patch.yml'),
]) {
  if (!existsSync(required)) {
    throw new Error(`web distribution artifact missing: ${required}; run pnpm run build && pnpm run stage:dsh first`)
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${String(result.status)}`)
  }
}

rmSync(packageDir, { recursive: true, force: true })
mkdirSync(join(packageDir, 'bin'), { recursive: true })
mkdirSync(join(packageDir, 'lib', 'dsh-studio-web'), { recursive: true })
mkdirSync(join(packageDir, 'lib', 'dsh-studio'), { recursive: true })

copyFileSync(join(root, 'dist', 'web.js'), join(packageDir, 'lib', 'dsh-studio-web', 'main.js'))
copyFileSync(join(root, 'dist', 'dsh-studio.js'), join(packageDir, 'lib', 'dsh-studio', 'cli.js'))
copyFileSync(join(root, 'dist', 'release-package.json'), join(packageDir, 'package.json'))
copyFileSync(join(root, 'LICENSE'), join(packageDir, 'LICENSE'))
copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(packageDir, 'THIRD_PARTY_NOTICES.md'))
// Keep the staged relative links relative: Node's default cpSync rewrites
// them as absolute links into this build's .stage, which would dangle after
// the package is extracted elsewhere.
cpSync(join(stage, 'dsh-runtime'), join(packageDir, 'dsh-runtime'), {
  recursive: true,
  verbatimSymlinks: true,
})
cpSync(join(stage, 'node-runtime'), join(packageDir, 'node-runtime'), {
  recursive: true,
  verbatimSymlinks: true,
})

const launcher = join(packageDir, 'bin', 'dsh-studio')
copyFileSync(join(root, 'bin', 'dsh-studio'), launcher)
chmodSync(launcher, 0o755)

const legacyLauncher = join(packageDir, 'bin', 'dsh-studio-web')
writeFileSync(legacyLauncher, `#!/usr/bin/env sh
# Compatibility launcher. Prefer: dsh-studio web
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$ROOT/bin/dsh-studio" web "$@"
`)
chmodSync(legacyLauncher, 0o755)
if (isWindowsTarget) {
  copyFileSync(join(root, 'bin', 'dsh-studio.cmd'), join(packageDir, 'bin', 'dsh-studio.cmd'))
  writeFileSync(join(packageDir, 'bin', 'dsh-studio-web.cmd'), [
    '@ECHO off',
    'SETLOCAL',
    'SET "ROOT=%~dp0.."',
    'CALL "%ROOT%\\bin\\dsh-studio.cmd" web %*',
    '',
  ].join('\r\n'))
}

writeFileSync(join(packageDir, 'README.md'), `# DSH Studio Web

DSH Studio 的轻量浏览器发行版，不包含 Electron。它携带 Web runtime、Node.js
和 Web 可用的内置插件，数据默认保存在 \`~/.dsh-studio\`。

## 启动

\`\`\`sh
./bin/dsh-studio web
\`\`\`

Windows：

\`\`\`bat
bin\\dsh-studio.cmd web
\`\`\`

默认地址是 \`http://127.0.0.1:3080\`。运行
\`./bin/dsh-studio web --help\` 查看监听地址、端口、数据目录和可信主机选项。
按 \`Ctrl+C\` 优雅退出。

默认只监听 loopback。向局域网开放前，请配置 \`--trusted-host\`、鉴权和 TLS。

## English

This is the lightweight DSH Studio browser distribution without Electron. It
includes the Web runtime, Node.js, and Web-compatible bundled plugins.

Start it with \`./bin/dsh-studio web\` (or \`bin\\dsh-studio.cmd web\` on Windows).
The default URL is \`http://127.0.0.1:3080\`. Run
\`./bin/dsh-studio web --help\` for host, port, data-directory, and trusted-host
options. Press \`Ctrl+C\` for a graceful shutdown.

Documentation: https://github.com/euanguo/dsh-studio-app/tree/main/docs
`)

const tarball = join(release, `${dirName}.tar.gz`)
const zip = join(release, `${dirName}.zip`)
rmSync(tarball, { force: true })
rmSync(zip, { force: true })
run('tar', ['-czf', tarball, dirName], { cwd: release })
if (isWindowsHost) {
  // bsdtar builds zip archives from the .zip suffix.
  run('tar', ['-a', '-cf', zip, dirName], { cwd: release })
} else {
  run('zip', portableZipArguments(zip, dirName), { cwd: release })
}

console.log(`Packaged DSH Studio Web ${version}: ${packageDir}`)
console.log(`  ${tarball}`)
console.log(`  ${zip}`)
