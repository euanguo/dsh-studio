import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'

const READY_LINE = /^dsh web: (https?:\/\/\S+)(?:\s|$)/

/** How the packaged runtime is launched on this surface. */
export interface RuntimeLauncher {
  /** Command that runs the CLI entry (e.g. Electron with ELECTRON_RUN_AS_NODE). */
  command: string
  args?: string[]
  /** Extra environment merged into the child process env. */
  env?: NodeJS.ProcessEnv
  /**
   * Interpreter mode: the launcher command (or `interpreterCommand` when
   * wrapped) IS the Node interpreter — Electron with ELECTRON_RUN_AS_NODE —
   * so the standalone `nodeBinary` is never passed as an argument. Without
   * this flag the nodeBinary is appended after the launcher args (plain
   * wrapper style).
   */
  interpreter?: boolean
  /**
   * The real interpreter when `command` is only a wrapper around it
   * (sandbox-exec around Electron-as-Node).
   */
  interpreterCommand?: string
}

/** Process launch contract for the packaged DSH runtime. */
export interface DshRuntimeOptions {
  args: string[]
  cliEntry: string
  cwd: string
  env: NodeJS.ProcessEnv
  launcher?: RuntimeLauncher
  nodeBinary: string
  /**
   * Node interpreter flags (e.g. `--expose-internals` for the loader/HMR
   * service). Placed before the CLI entry in every launch shape so both the
   * standalone binary and the shared Electron interpreter honor them.
   */
  nodeFlags?: string[]
  readyTimeoutMs?: number
  onLog?: (stream: 'stderr' | 'stdout', line: string) => void
}

/** Resolved spawn vector for one DSH runtime launch. */
export interface LaunchCommand {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

/**
 * Assemble the spawn vector for the DSH runtime. Four shapes:
 * - plain: nodeBinary + cliEntry (Web/TUI distribution without Electron).
 * - interpreter launcher (Electron as Node): the launcher command IS the
 *   interpreter; nodeBinary is never passed.
 * - wrapped interpreter: `command` wraps `interpreterCommand`
 *   (sandbox-exec around Electron-as-Node).
 * - wrapper launcher: launcher args + nodeBinary + cliEntry.
 */
export function buildLaunchCommand(options: DshRuntimeOptions): LaunchCommand {
  const processArgs = options.args
  const launcher = options.launcher
  // Interpreter flags must precede the CLI entry for the interpreter to
  // honor them (node flags are only parsed before the script path).
  const flags = options.nodeFlags ?? []
  if (launcher === undefined) {
    return {
      command: options.nodeBinary,
      args: [...flags, options.cliEntry, ...processArgs],
      env: options.env,
    }
  }
  const env = { ...options.env, ...launcher.env }
  if (launcher.interpreter === true) {
    if (launcher.interpreterCommand !== undefined) {
      return {
        command: launcher.command,
        args: [...(launcher.args ?? []), launcher.interpreterCommand, ...flags, options.cliEntry, ...processArgs],
        env,
      }
    }
    return {
      command: launcher.command,
      args: [...(launcher.args ?? []), ...flags, options.cliEntry, ...processArgs],
      env,
    }
  }
  return {
    command: launcher.command,
    args: [...(launcher.args ?? []), options.nodeBinary, ...flags, options.cliEntry, ...processArgs],
    env,
  }
}

/** Exit details emitted after an already-ready runtime terminates. */
export interface RuntimeExit {
  code: number | null
  signal: NodeJS.Signals | null
}

interface Deferred<T> {
  promise: Promise<T>
  reject(reason: unknown): void
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, reject, resolve }
}

function lineReader(consume: (line: string) => void): (chunk: Buffer) => void {
  let pending = ''
  return (chunk: Buffer): void => {
    pending += chunk.toString('utf8')
    for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
      const line = pending.slice(0, newline).replace(/\r$/, '')
      pending = pending.slice(newline + 1)
      consume(line)
    }
  }
}

/** Supervise one DSH Host process and expose its loopback readiness URL. */
export class DshRuntimeSupervisor extends EventEmitter {
  private child: ChildProcessByStdio<null, Readable, Readable> | undefined
  private readonly options: DshRuntimeOptions
  private ready = false

  constructor(options: DshRuntimeOptions) {
    super()
    this.options = options
  }

  /** Whether a child process is currently owned by this supervisor. */
  get running(): boolean {
    return this.child !== undefined
  }

  /** Start DSH and resolve only after the bundle's post-settlement URL line. */
  async start(): Promise<URL> {
    if (this.child !== undefined) throw new Error('DSH runtime is already running')
    this.ready = false
    const launch = buildLaunchCommand(this.options)
    const child = spawn(launch.command, launch.args, {
      cwd: this.options.cwd,
      env: launch.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    const readiness = deferred<URL>()
    let settled = false
    const settleFailure = (error: Error): void => {
      if (settled) return
      settled = true
      readiness.reject(error)
    }
    const consume = (stream: 'stderr' | 'stdout', line: string): void => {
      this.options.onLog?.(stream, line)
      this.emit('log', stream, line)
      if (stream !== 'stdout' || settled) return
      const match = READY_LINE.exec(line)
      if (match?.[1] === undefined) return
      settled = true
      this.ready = true
      readiness.resolve(new URL(match[1]))
    }
    child.stdout.on('data', lineReader(line => { consume('stdout', line) }))
    child.stderr.on('data', lineReader(line => { consume('stderr', line) }))
    child.once('error', (error) => {
      settleFailure(new Error(`failed to launch DSH runtime: ${error.message}`, { cause: error }))
    })
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = undefined
      if (!this.ready) {
        settleFailure(new Error(`DSH runtime exited before readiness (code=${String(code)}, signal=${String(signal)})`))
      } else {
        this.ready = false
        this.emit('exit', { code, signal } satisfies RuntimeExit)
      }
    })
    const timeout = setTimeout(() => {
      settleFailure(new Error(`DSH runtime did not become ready within ${String(this.options.readyTimeoutMs ?? 45_000)} ms`))
      child.kill('SIGTERM')
    }, this.options.readyTimeoutMs ?? 45_000)
    try {
      return await readiness.promise
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Stop DSH gracefully, escalating only after the bounded teardown window. */
  async stop(timeoutMs = 8_000): Promise<void> {
    const child = this.child
    if (child === undefined) return
    const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
    child.kill('SIGTERM')
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => { resolve('timeout') }, timeoutMs)
    })
    const result = await Promise.race([exited.then(() => 'exit' as const), timedOut])
    if (timer !== undefined) clearTimeout(timer)
    if (result === 'timeout' && child.exitCode === null) {
      child.kill('SIGKILL')
      await exited
    }
    if (this.child === child) this.child = undefined
    this.ready = false
  }
}

/** Run a bounded, non-interactive DSH command such as profile plugin install. */
export async function runDshCommand(
  options: Omit<DshRuntimeOptions, 'args'>,
  args: string[],
  timeoutMs = 120_000,
): Promise<{ stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) => {
    const launch = buildLaunchCommand({ ...options, args })
    const child = spawn(launch.command, launch.args, {
      cwd: options.cwd,
      env: launch.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`DSH command timed out after ${String(timeoutMs)} ms`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stderr, stdout })
      else reject(new Error(
        `DSH command failed (code=${String(code)}, signal=${String(signal)})\n${stderr || stdout}`,
      ))
    })
  })
}
