import { spawn } from 'node:child_process'
import {
  constants,
  accessSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path'
import type { MarketplaceAuthStatus } from '../protocol.ts'
import {
  MARKETPLACE_CATALOG_PATH,
  MARKETPLACE_CATALOG_REPOSITORY,
} from '../protocol.ts'

export interface MarketplaceAuthResult {
  detail: string
  status: MarketplaceAuthStatus
}

export interface DshCommandInput {
  args: string[]
  dshHome: string
  sandboxRoot: string
}

export interface BundleBuildInput {
  checkout: string
  sandboxRoot: string
  scripts: string[]
}

/** Privileged operations consumed by the marketplace transaction module. */
export interface MarketplacePlatform {
  authStatus(): Promise<MarketplaceAuthResult>
  buildBundle(input: BundleBuildInput): Promise<void>
  cloneRepository(repository: string, commit: string, target: string): Promise<void>
  loadCatalog(): Promise<unknown>
  readRepositoryFile(repository: string, path: string, commit: string): Promise<string | null>
  resolveCommit(repository: string): Promise<string>
  runDsh(input: DshCommandInput): Promise<void>
}

export interface ProductionMarketplacePlatformOptions {
  cliEntry: string
  cwd: string
  env: NodeJS.ProcessEnv
  fetch?: typeof globalThis.fetch
  nodeBinary: string
  pnpmEntry: string
  onLog?: (message: string) => void
}

interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

function validateRepository(repository: string): void {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error(`invalid marketplace repository: ${JSON.stringify(repository)}`)
  }
}

function repositoryContentPath(repository: string, path: string): string {
  validateRepository(repository)
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error(`invalid repository file path: ${JSON.stringify(path)}`)
  }
  return `repos/${repository}/contents/${segments.map(encodeURIComponent).join('/')}`
}

function commandError(command: string, args: readonly string[], stderr: string, stdout: string): Error {
  const detail = stderr.trim() || stdout.trim() || 'command returned a non-zero status'
  return new Error(`${command} ${args.join(' ')} failed: ${detail}`)
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<{ stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const consume = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        finish(() => { reject(new Error(`${command} produced too much output`)) })
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => { consume(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { consume(stderr, chunk) })
    child.once('error', (error) => { finish(() => { reject(error) }) })
    child.once('exit', (code, signal) => {
      finish(() => {
        const out = Buffer.concat(stdout).toString('utf8')
        const err = Buffer.concat(stderr).toString('utf8')
        if (code === 0) resolve({ stderr: err, stdout: out })
        else reject(commandError(command, args, err, `${out}\nsignal=${String(signal)}`))
      })
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => { reject(new Error(`${command} timed out after ${String(options.timeoutMs ?? 120_000)} ms`)) })
    }, options.timeoutMs ?? 120_000)
  })
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function assertWithin(root: string, target: string): void {
  const child = relative(resolve(root), resolve(target))
  if (child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))) {
    return
  }
  throw new Error(`marketplace build path escapes its preview sandbox: ${target}`)
}

/** Resolve gh without invoking a shell or changing the user's Git config. */
export function findGitHubCli(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  isExecutable: (path: string) => boolean = executable,
): string | null {
  const explicit = environment.DSH_DESKTOP_GH_PATH
  if (explicit !== undefined && isExecutable(explicit)) return explicit
  const paths = platform === 'win32' ? win32 : posix
  const executableNames = platform === 'win32' ? ['gh.exe', 'gh.cmd', 'gh'] : ['gh']
  const candidates = [
    ...(environment.PATH ?? (platform === 'win32' ? environment.Path : undefined) ?? '')
      .split(paths.delimiter)
      .filter(Boolean)
      .flatMap(directory => executableNames.map(name => paths.join(directory, name))),
    ...(platform === 'darwin' ? ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'] : []),
    ...(platform === 'linux' ? ['/usr/local/bin/gh', '/usr/bin/gh'] : []),
  ]
  return candidates.find((candidate, index) => candidates.indexOf(candidate) === index && isExecutable(candidate)) ?? null
}

function withoutCommandLineGitConfig(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...environment }
  for (const key of Object.keys(clean)) {
    if (key === 'GIT_CONFIG_COUNT' || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) {
      delete clean[key]
    }
  }
  return clean
}

function gitConfigString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** Let child git processes ask gh without changing the user's Git config. */
export function withGitHubCredentials(
  environment: NodeJS.ProcessEnv,
  ghPath: string | null,
): NodeJS.ProcessEnv {
  const clean = withoutCommandLineGitConfig(environment)
  if (ghPath === null) return clean
  const appDataPath = clean.DSH_DESKTOP_APP_DATA
  if (appDataPath === undefined || appDataPath === '') return clean
  const directory = join(appDataPath, 'plugin-marketplace')
  const configPath = join(directory, 'gitconfig')
  const temporary = `${configPath}.tmp-${String(process.pid)}`
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(temporary, [
    '[credential "https://github.com"]',
    `\thelper = !${gitConfigString(ghPath)} auth git-credential`,
    '',
  ].join('\n'), { mode: 0o600 })
  renameSync(temporary, configPath)
  return {
    ...clean,
    GIT_CONFIG_GLOBAL: configPath,
  }
}

function seatbeltString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

/** Deny writes outside the disposable preview tree while allowing DSH to run. */
export function previewSandboxPolicy(root: string): string {
  const writableRoots = new Set([resolve(root)])
  if (existsSync(root)) writableRoots.add(realpathSync(root))
  const writablePaths = [...writableRoots]
    .flatMap(path => [path, join(path, '.tmp')])
    .map(path => `(subpath "${seatbeltString(path)}")`)
    .join(' ')
  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow file-read*)',
    '(allow network*)',
    '(allow mach-lookup)',
    '(allow sysctl-read)',
    `(allow file-write* (literal "/dev/null") ${writablePaths})`,
  ].join('')
}

interface PreviewScriptCommandInput {
  nodeArguments: string[]
  nodeBinary: string
  pathExists?: (path: string) => boolean
  platform?: NodeJS.Platform
  root: string
  sandbox?: string
}

/** Select a write-restricted launcher or reject the scripted preview. */
export function previewScriptCommand(
  input: PreviewScriptCommandInput,
): { args: string[]; command: string } {
  const platform = input.platform ?? process.platform
  const sandbox = input.sandbox ?? '/usr/bin/sandbox-exec'
  const pathExists = input.pathExists ?? existsSync
  if (platform !== 'darwin' || !pathExists(sandbox)) {
    throw new Error(
      `scripted marketplace previews require a write-restricted process sandbox, which is unavailable on ${platform}`,
    )
  }
  return {
    args: [
      '-p',
      previewSandboxPolicy(input.root),
      input.nodeBinary,
      ...input.nodeArguments,
    ],
    command: sandbox,
  }
}

export class ProductionMarketplacePlatform implements MarketplacePlatform {
  readonly #ghPath: string | null
  readonly #options: ProductionMarketplacePlatformOptions

  constructor(options: ProductionMarketplacePlatformOptions) {
    this.#options = options
    this.#ghPath = findGitHubCli(options.env)
  }

  async authStatus(): Promise<MarketplaceAuthResult> {
    if (this.#ghPath === null) {
      return {
        detail: 'Install GitHub CLI and run `gh auth login` to browse private organization plugins.',
        status: 'missing-cli',
      }
    }
    try {
      await runCommand(this.#ghPath, ['auth', 'status', '--hostname', 'github.com'], {
        env: this.#options.env,
        timeoutMs: 15_000,
      })
      return { detail: 'Authenticated with GitHub CLI.', status: 'ready' }
    } catch (error) {
      return {
        detail: error instanceof Error ? error.message : String(error),
        status: 'signed-out',
      }
    }
  }

  async buildBundle(input: BundleBuildInput): Promise<void> {
    assertWithin(input.sandboxRoot, input.checkout)
    const allowed = new Set(['preinstall', 'install', 'postinstall', 'prepare', 'prepack'])
    if (input.scripts.length === 0 || input.scripts.some(script => !allowed.has(script))) {
      throw new Error('marketplace bundle build contains an unreviewed lifecycle script')
    }
    const temporary = join(input.sandboxRoot, '.tmp')
    const store = join(input.sandboxRoot, '.pnpm-store')
    mkdirSync(temporary, { recursive: true, mode: 0o700 })
    mkdirSync(store, { recursive: true, mode: 0o700 })
    const env = withGitHubCredentials({
      ...this.#options.env,
      CI: 'true',
      DSH_DESKTOP_APP_DATA: input.sandboxRoot,
      DSH_DESKTOP_PREVIEW: '1',
      HOME: input.sandboxRoot,
      TMPDIR: temporary,
    }, this.#ghPath)
    const pnpmArguments = [
      this.#options.pnpmEntry,
      'install',
      '--ignore-workspace',
      existsSync(join(input.checkout, 'pnpm-lock.yaml'))
        ? '--frozen-lockfile'
        : '--no-frozen-lockfile',
      '--store-dir',
      store,
    ]
    const launcher = previewScriptCommand({
      nodeArguments: pnpmArguments,
      nodeBinary: this.#options.nodeBinary,
      root: input.sandboxRoot,
    })
    this.#options.onLog?.(
      `marketplace build: pnpm install (${input.scripts.join(', ')})`,
    )
    const result = await runCommand(launcher.command, launcher.args, {
      cwd: input.checkout,
      env,
      timeoutMs: 300_000,
    })
    if (result.stdout.trim() !== '') this.#options.onLog?.(result.stdout.trim())
    if (result.stderr.trim() !== '') this.#options.onLog?.(result.stderr.trim())
  }

  async loadCatalog(): Promise<unknown> {
    const locator = this.#options.env.OH_DSH_MARKETPLACE_CATALOG
      ?? `${MARKETPLACE_CATALOG_REPOSITORY}/${MARKETPLACE_CATALOG_PATH}`
    const match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(.+)$/.exec(locator)
    if (match === null) {
      throw new Error('OH_DSH_MARKETPLACE_CATALOG must be owner/repository/path')
    }
    validateRepository(match[1] ?? '')
    const path = match[2] ?? ''
    const contentPath = repositoryContentPath(match[1] ?? '', path)
    const request = this.#options.fetch ?? globalThis.fetch
    let publicError: unknown
    try {
      const response = await request(`https://api.github.com/${contentPath}`, {
        headers: {
          accept: 'application/vnd.github.raw+json',
          'user-agent': 'oh-dsh-desktop',
        },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`GitHub public catalog request failed with HTTP ${String(response.status)}`)
      return JSON.parse(await response.text()) as unknown
    } catch (error) {
      publicError = error
    }
    if (this.#ghPath !== null) {
      try {
        const result = await runCommand(this.#ghPath, [
          'api',
          contentPath,
          '--jq',
          '.content',
        ], { env: this.#options.env, timeoutMs: 30_000 })
        return JSON.parse(Buffer.from(result.stdout.replaceAll(/\s/g, ''), 'base64').toString('utf8')) as unknown
      } catch (authenticatedError) {
        throw new Error(
          `failed to load marketplace catalog anonymously (${String(publicError)}) or with GitHub CLI (${String(authenticatedError)})`,
        )
      }
    }
    throw new Error(`failed to load public marketplace catalog: ${String(publicError)}`)
  }

  async resolveCommit(repository: string): Promise<string> {
    validateRepository(repository)
    const gh = this.requireGitHubCli()
    const result = await runCommand(gh, [
      'api',
      `repos/${repository}/commits/HEAD`,
      '--jq',
      '.sha',
    ], { env: this.#options.env, timeoutMs: 30_000 })
    const commit = result.stdout.trim()
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`GitHub returned an invalid commit for ${repository}`)
    return commit
  }

  async readRepositoryFile(repository: string, path: string, commit: string): Promise<string | null> {
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('repository commit must be a full SHA')
    const gh = this.requireGitHubCli()
    try {
      const result = await runCommand(gh, [
        'api',
        `${repositoryContentPath(repository, path)}?ref=${commit}`,
        '--jq',
        '.content',
      ], { env: this.#options.env, timeoutMs: 30_000 })
      return Buffer.from(result.stdout.replaceAll(/\s/g, ''), 'base64').toString('utf8')
    } catch (error) {
      if (error instanceof Error && /404|Not Found/i.test(error.message)) return null
      throw error
    }
  }

  async cloneRepository(repository: string, commit: string, target: string): Promise<void> {
    validateRepository(repository)
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('repository commit must be a full SHA')
    const gh = this.requireGitHubCli()
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    await runCommand(gh, [
      'repo',
      'clone',
      repository,
      target,
      '--',
      '--filter=blob:none',
      '--no-checkout',
    ], { env: this.#options.env, timeoutMs: 120_000 })
    await runCommand('git', ['-C', target, 'checkout', '--detach', commit], {
      env: withGitHubCredentials(this.#options.env, gh),
      timeoutMs: 60_000,
    })
  }

  async runDsh(input: DshCommandInput): Promise<void> {
    const temporary = join(input.sandboxRoot, '.tmp')
    mkdirSync(temporary, { recursive: true, mode: 0o700 })
    const env = withGitHubCredentials({
      ...this.#options.env,
      DSH_DESKTOP_APP_DATA: input.sandboxRoot,
      DSH_DESKTOP_PREVIEW: '1',
      DSH_HOME: input.dshHome,
      TMPDIR: temporary,
    }, this.#ghPath)
    const nodeArguments = [this.#options.cliEntry, ...input.args]
    const sandbox = '/usr/bin/sandbox-exec'
    const command = process.platform === 'darwin' && existsSync(sandbox) ? sandbox : this.#options.nodeBinary
    const args = command === sandbox
      ? ['-p', previewSandboxPolicy(input.sandboxRoot), this.#options.nodeBinary, ...nodeArguments]
      : nodeArguments
    this.#options.onLog?.(`marketplace command: dsh ${input.args.join(' ')}`)
    const result = await runCommand(command, args, {
      cwd: this.#options.cwd,
      env,
      timeoutMs: 180_000,
    })
    if (result.stdout.trim() !== '') this.#options.onLog?.(result.stdout.trim())
    if (result.stderr.trim() !== '') this.#options.onLog?.(result.stderr.trim())
  }

  private requireGitHubCli(): string {
    if (this.#ghPath === null) throw new Error('GitHub CLI is unavailable; install gh and run `gh auth login`')
    return this.#ghPath
  }
}

/** Stable preview temp root used by tests and UI diagnostics. */
export function defaultPreviewTemporaryRoot(): string {
  return join(tmpdir(), 'oh-dsh-plugin-preview')
}
