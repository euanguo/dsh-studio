/** POSIX adapter for GUI-launched Desktop environments. */

import { spawn, type ChildProcess } from 'node:child_process'
import { userInfo } from 'node:os'
import { delimiter } from 'node:path'
import type {
  LoginShellExecution,
  LoginShellRunner,
  ResolveUserEnvironmentOptions,
  UserEnvironmentIssue,
  UserEnvironmentResolution,
} from './user-environment.ts'

const LOGIN_SHELL_TIMEOUT_MS = 5_000
const LOGIN_SHELL_MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const POSIX_BOOTSTRAP_PATH = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
const VOLATILE_SHELL_KEYS = new Set(['PWD', 'OLDPWD', 'SHLVL', '_'])
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim() ?? ''
  return result === '' ? undefined : result
}

function accountLoginShell(): string | undefined {
  try {
    return trimmed(userInfo().shell ?? undefined)
  } catch {
    return undefined
  }
}

function shellCandidates(options: ResolveUserEnvironmentOptions): string[] {
  const base = options.base ?? process.env
  const candidates = [trimmed(base.SHELL), trimmed(options.loginShell), accountLoginShell()]
  if ((options.platform ?? process.platform) === 'darwin') candidates.push('/bin/zsh', '/bin/bash')
  else candidates.push('/bin/bash', '/bin/sh')
  return [...new Set(candidates.filter((value): value is string => value !== undefined))]
}

function bootstrapEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const inherited = trimmed(base.PATH)
  return {
    ...base,
    PATH: [...(inherited === undefined ? [] : [inherited]), ...POSIX_BOOTSTRAP_PATH].join(delimiter),
  }
}

function runLoginShell(shell: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<LoginShellExecution> {
  return new Promise(resolve => {
    const child: ChildProcess = spawn(shell, args, {
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const chunks: Buffer[] = []
    let outputBytes = 0
    let settled = false
    let timedOut = false
    const finish = (result: LoginShellExecution): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, LOGIN_SHELL_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > LOGIN_SHELL_MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        finish({ output: Buffer.alloc(0), outputTooLarge: true, status: null, timedOut: false })
        return
      }
      chunks.push(chunk)
    })
    child.once('error', error => {
      finish({ error, output: Buffer.concat(chunks), status: null, timedOut })
    })
    child.once('close', status => {
      finish({
        output: Buffer.concat(chunks),
        status,
        timedOut,
      })
    })
  })
}

/** Parse one POSIX login-shell environment without trusting startup chatter. */
export function parseLoginShellEnvironment(output: Buffer | string): NodeJS.ProcessEnv {
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output, 'utf8')
  const environment: NodeJS.ProcessEnv = {}
  const entries = bytes.toString('utf8').split('\0')
  const begin = entries.indexOf('__DSH_ENV_BEGIN__')
  const end = entries.indexOf('__DSH_ENV_END__', begin + 1)
  const selected = begin >= 0 && end > begin ? entries.slice(begin + 1, end) : entries
  for (const entry of selected) {
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    const key = entry.slice(0, separator)
    if (!ENVIRONMENT_KEY.test(key) || VOLATILE_SHELL_KEYS.has(key)) continue
    environment[key] = entry.slice(separator + 1)
  }
  return environment
}

function mergeLoginEnvironment(
  base: NodeJS.ProcessEnv,
  parsed: NodeJS.ProcessEnv,
  shell: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...base, ...parsed }
  for (const key of VOLATILE_SHELL_KEYS) delete environment[key]
  if (environment.SHELL === undefined) environment.SHELL = shell
  return environment
}

function issueForExecution(execution: LoginShellExecution, parsed: NodeJS.ProcessEnv): UserEnvironmentIssue | undefined {
  if (execution.timedOut === true) return 'timeout'
  if (execution.error !== undefined) return 'spawn-error'
  if (execution.outputTooLarge === true || execution.output.byteLength > LOGIN_SHELL_MAX_OUTPUT_BYTES) return 'output-too-large'
  if (execution.status !== 0) return 'exit'
  if (trimmed(parsed.PATH) === undefined || trimmed(parsed.HOME) === undefined) return 'invalid-output'
  return undefined
}

/** Resolve the user's POSIX login environment, falling back without blocking Desktop. */
export async function resolvePosixUserEnvironment(
  options: ResolveUserEnvironmentOptions = {},
  runShell: LoginShellRunner = runLoginShell,
): Promise<UserEnvironmentResolution> {
  const base = options.base ?? process.env
  const candidates = shellCandidates(options)
  const shell = candidates[0] ?? null
  if (shell === null) return { env: { ...base }, shell, source: 'process' }

  let lastIssue: UserEnvironmentIssue | undefined
  for (const candidate of candidates) {
    const execution = await runShell(
      candidate,
      ['-ilc', "printf '__DSH_ENV_BEGIN__\\0'; command env -0; printf '__DSH_ENV_END__\\0'"],
      bootstrapEnvironment(base),
    )
    const parsed = parseLoginShellEnvironment(execution.output)
    const issue = issueForExecution(execution, parsed)
    if (issue === undefined) {
      return {
        env: mergeLoginEnvironment(base, parsed, candidate),
        shell: candidate,
        source: 'login-shell',
      }
    }
    lastIssue = issue
    if (execution.error === undefined) break
  }
  return {
    env: { ...base },
    ...(lastIssue === undefined ? {} : { issue: lastIssue }),
    shell,
    source: 'process',
  }
}
