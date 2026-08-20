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
const dirName = `dsh-studio-tui-${version}-${platform}-${arch}`
const packageDir = join(release, dirName)
const packagedNode = join(packageDir, 'node-runtime', isWindowsTarget ? 'node.exe' : join('bin', 'node'))

for (const required of [
  join(root, 'dist', 'dsh-studio.js'),
  join(stage, 'dsh-runtime', 'lib', 'bin.js'),
  stagedNode,
  join(stage, 'dsh-runtime', 'node_modules', 'dsh-cc-tui', 'lib', 'types', 'index.js'),
  join(stage, 'dsh-runtime', 'node_modules', '@dsh-studio', 'tui', 'dist', 'index.js'),
  join(stage, 'dsh-runtime', 'node_modules', '@dsh-studio', 'tui', 'dist', 'cordis.patch.yml'),
]) {
  if (!existsSync(required)) {
    throw new Error(`TUI distribution artifact missing: ${required}; run pnpm run build && pnpm run stage:dsh first`)
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
mkdirSync(join(packageDir, 'lib', 'dsh-studio'), { recursive: true })

copyFileSync(join(root, 'dist', 'dsh-studio.js'), join(packageDir, 'lib', 'dsh-studio', 'cli.js'))
copyFileSync(join(root, 'dist', 'release-package.json'), join(packageDir, 'package.json'))
copyFileSync(join(root, 'LICENSE'), join(packageDir, 'LICENSE'))
copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(packageDir, 'THIRD_PARTY_NOTICES.md'))
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
if (isWindowsTarget) {
  copyFileSync(join(root, 'bin', 'dsh-studio.cmd'), join(packageDir, 'bin', 'dsh-studio.cmd'))
}

writeFileSync(join(packageDir, 'README.md'), `# DSH Studio TUI

DSH Studio 的轻量终端发行版，不包含 Electron。终端渲染与交互由固定版本的
[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 提供，DSH Studio 维护统一
launcher、Profile、默认配置和发行打包。

## 启动

\`\`\`sh
./bin/dsh-studio tui
\`\`\`

Windows：\`bin\\dsh-studio.cmd tui\`。运行 \`./bin/dsh-studio tui --help\` 查看
工作区、会话恢复、语言、preset 和渲染模式选项。

## English

This is the lightweight DSH Studio terminal distribution without Electron. Its
renderer and interaction model come from the pinned
[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) upstream; DSH Studio owns the
unified launcher, Profile defaults, and packaging.

Start it with \`./bin/dsh-studio tui\` (or \`bin\\dsh-studio.cmd tui\` on Windows).
Run \`./bin/dsh-studio tui --help\` for workspace, resume, language, preset, and
rendering options.

Documentation: https://github.com/euanguo/dsh-studio-app/tree/main/docs
`)

const tarball = join(release, `${dirName}.tar.gz`)
const zip = join(release, `${dirName}.zip`)
rmSync(tarball, { force: true })
rmSync(zip, { force: true })
run('tar', ['-czf', tarball, dirName], { cwd: release })
if (isWindowsHost) {
  run('tar', ['-a', '-cf', zip, dirName], { cwd: release })
} else {
  run('zip', portableZipArguments(zip, dirName), { cwd: release })
}

console.log(`Packaged DSH Studio TUI ${version}: ${packageDir}`)
console.log(`  ${tarball}`)
console.log(`  ${zip}`)

const hostPlatform = { darwin: 'darwin', linux: 'linux', win: 'win32' }[platform]
if (hostPlatform === process.platform) {
  run(packagedNode, [join(packageDir, 'lib', 'dsh-studio', 'cli.js'), 'tui', '--help'], {
    cwd: packageDir,
    env: { ...process.env, DSH_STUDIO_TUI_ROOT: packageDir },
  })
} else {
  console.log(`Skipping packaged smoke test: ${platform} runtime cannot launch on ${process.platform}`)
}
