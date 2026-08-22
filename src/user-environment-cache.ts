/** Durable cache for the resolved login environment. */

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const ENVIRONMENT_CACHE_VERSION = 1

export interface RcFileStat {
  mtimeMs: number
  path: string
  size: number
}

export interface EnvironmentCacheRecord {
  createdAt: number
  env: NodeJS.ProcessEnv
  fingerprint: string
  version: 1
}

export interface EnvironmentCache {
  read(path: string): EnvironmentCacheRecord | null
  write(path: string, record: EnvironmentCacheRecord): void
}

/** rc files a POSIX login shell may load. Order is load-order-ish and stable. */
export const POSIX_RC_FILES = [
  '.zshenv',
  '.zprofile',
  '.zshrc',
  '.zlogin',
  '.profile',
  '.bash_profile',
  '.bashrc',
]

/** Session- or transport-scoped variables must never be replayed from cache. */
export const SESSION_TRANSPORT_KEYS = new Set([
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'SSH_CONNECTION',
  'SSH_TTY',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'DBUS_SESSION_BUS_ADDRESS',
  'TERM_SESSION_ID',
  'TMUX',
  'TMUX_PANE',
])

export type RcFileStatProbe = (path: string) => RcFileStat | null

function statRcFile(path: string): RcFileStat | null {
  try {
    const stat = statSync(path)
    return { mtimeMs: stat.mtimeMs, path, size: stat.size }
  } catch {
    return null
  }
}

/** Stable fingerprint of everything that can change the login environment. */
export function environmentFingerprint(
  base: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  stat: RcFileStatProbe = statRcFile,
  home: string = base.HOME ?? homedir(),
): string {
  const rcFiles = POSIX_RC_FILES
    .map(name => stat(join(home, name)))
    .filter((value): value is RcFileStat => value !== null)
    .map(value => `${value.path}:${Math.trunc(value.mtimeMs)}:${value.size}`)
  return JSON.stringify({
    home,
    platform,
    rcFiles,
    shell: base.SHELL ?? null,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseRecord(raw: string): EnvironmentCacheRecord | null {
  const value = JSON.parse(raw) as unknown
  if (!isRecord(value)
    || value.version !== ENVIRONMENT_CACHE_VERSION
    || typeof value.createdAt !== 'number'
    || typeof value.fingerprint !== 'string'
    || !isRecord(value.env)) {
    return null
  }
  return {
    createdAt: value.createdAt,
    env: value.env as NodeJS.ProcessEnv,
    fingerprint: value.fingerprint,
    version: ENVIRONMENT_CACHE_VERSION,
  }
}

function withoutSessionTransportVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env }
  for (const key of SESSION_TRANSPORT_KEYS) delete clean[key]
  return clean
}

/** Default disk-backed cache: 0600 atomic replace under the DSH data root. */
export const defaultEnvironmentCache: EnvironmentCache = {
  read(path) {
    try {
      return parseRecord(readFileSync(path, 'utf8'))
    } catch {
      return null
    }
  },
  write(path, record) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const temporary = `${path}.tmp-${String(process.pid)}`
    writeFileSync(temporary, JSON.stringify({
      ...record,
      env: withoutSessionTransportVariables(record.env),
    }) + '\n', { mode: 0o600 })
    renameSync(temporary, path)
  },
}
