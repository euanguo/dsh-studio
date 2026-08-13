import { spawn } from 'node:child_process'
import {
  constants,
  accessSync,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, win32 } from 'node:path'
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

/** Privileged operations consumed by the marketplace transaction module. */
export interface MarketplacePlatform {
  authStatus(): Promise<MarketplaceAuthResult>
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
  nodeBinary: string
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
  const temporary = join(root, '.tmp')
  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow file-read*)',
    '(allow network*)',
    '(allow mach-lookup)',
    '(allow sysctl-read)',
    `(allow file-write* (literal "/dev/null") (subpath "${seatbeltString(root)}") (subpath "${seatbeltString(temporary)}"))`,
  ].join('')
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

  async loadCatalog(): Promise<unknown> {
    const gh = this.requireGitHubCli()
    const locator = this.#options.env.OH_DSH_MARKETPLACE_CATALOG
      ?? `${MARKETPLACE_CATALOG_REPOSITORY}/${MARKETPLACE_CATALOG_PATH}`
    const match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(.+)$/.exec(locator)
    if (match === null) {
      throw new Error('OH_DSH_MARKETPLACE_CATALOG must be owner/repository/path')
    }
    validateRepository(match[1] ?? '')
    const path = match[2] ?? ''
    const contentPath = repositoryContentPath(match[1] ?? '', path)
    const result = await runCommand(gh, [
      'api',
      contentPath,
      '--jq',
      '.content',
    ], { env: this.#options.env, timeoutMs: 30_000 })
    return JSON.parse(Buffer.from(result.stdout.replaceAll(/\s/g, ''), 'base64').toString('utf8')) as unknown
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
