import * as nodePty from 'node-pty'
import { createTerminalSpawnEnvironment } from './terminal-environment.ts'
import {
  isRetryableShellSpawnError,
  resolveShellCandidates,
  shellSpawnArgs,
} from './shell-resolver.ts'

export interface SpawnTerminalPtyOptions {
  shell: string
  cwd: string
  cols: number
  rows: number
  env?: NodeJS.ProcessEnv
}

/** Spawn the embedded terminal, trying only retryable shell-resolution errors. */
export function spawnTerminalPty(options: SpawnTerminalPtyOptions): nodePty.IPty {
  let lastError: unknown
  for (const shell of resolveShellCandidates({ explicit: options.shell })) {
    try {
      return nodePty.spawn(shell, shellSpawnArgs(), {
        name: 'xterm-256color',
        cols: Math.max(2, Math.floor(options.cols)),
        rows: Math.max(2, Math.floor(options.rows)),
        cwd: options.cwd,
        env: createTerminalSpawnEnvironment(options.env).env,
      })
    } catch (error) {
      lastError = error
      if (!isRetryableShellSpawnError(error)) throw error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`unable to spawn terminal shell: ${String(lastError)}`)
}
