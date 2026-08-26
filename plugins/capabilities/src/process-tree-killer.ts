/**
 * Process tree capture and termination without losing reparented children
 * (ported from synara's `apps/server/src/terminal/processTreeKiller.ts`).
 *
 * Self-contained: parses `ps` process maps, confirms identity before signaling
 * to prevent killing recycled PIDs, signals descendants in leaf-first order,
 * and terminates the root process.
 */
import { spawnSync } from 'node:child_process'

const PROCESS_TREE_SCAN_TIMEOUT_MS = 1_000
const PROCESS_TREE_SCAN_MAX_BUFFER_BYTES = 262_144
const PROCESS_COMMAND_SCAN_MAX_BUFFER_BYTES = 262_144

export type ProcessChildrenMap = Map<number, Array<CapturedProcess>>
export type ProcessCommandMap = Map<number, string>

export interface CapturedProcess {
  pid: number
  command: string
}

export interface CapturedProcessTree {
  descendants: CapturedProcess[]
}

export type TerminalKillSignal = 'SIGTERM' | 'SIGKILL'

export interface ProcessTreeKiller {
  capture(rootPid: number): CapturedProcessTree
  signalCaptured(rootPid: number, tree: CapturedProcessTree, signal: TerminalKillSignal): void
  killTree(rootPid: number, signal?: TerminalKillSignal): void
}

export function parseProcessChildrenMap(psOutput: string): ProcessChildrenMap {
  const childrenByParentPid: ProcessChildrenMap = new Map()
  for (const line of psOutput.split(/\r?\n/g)) {
    const [pidRaw, ppidRaw, ...commandParts] = line.trim().split(/\s+/g)
    const pid = Number(pidRaw)
    const ppid = Number(ppidRaw)
    const command = commandParts.join(' ').trim()
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
    if (command.length === 0) continue
    const siblings = childrenByParentPid.get(ppid) ?? []
    siblings.push({ pid, command })
    childrenByParentPid.set(ppid, siblings)
  }
  return childrenByParentPid
}

export function parseProcessCommandMap(psOutput: string): ProcessCommandMap {
  const commandsByPid: ProcessCommandMap = new Map()
  for (const line of psOutput.split(/\r?\n/g)) {
    const match = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line)
    if (!match) continue
    const pid = Number(match[1])
    const command = match[2]?.trim() ?? ''
    if (!Number.isInteger(pid) || command.length === 0) continue
    commandsByPid.set(pid, command)
  }
  return commandsByPid
}

export function collectDescendantProcesses(
  parentPid: number,
  childrenByParentPid: ProcessChildrenMap,
): CapturedProcess[] {
  const descendants: CapturedProcess[] = []
  const stack = [...(childrenByParentPid.get(parentPid) ?? [])].reverse()
  const visited = new Set<number>([parentPid])

  while (stack.length > 0) {
    const child = stack.pop()
    if (!child || visited.has(child.pid)) {
      continue
    }
    visited.add(child.pid)
    descendants.push(child)

    const nestedChildren = childrenByParentPid.get(child.pid) ?? []
    for (const nestedChild of [...nestedChildren].reverse()) {
      stack.push(nestedChild)
    }
  }

  return descendants
}

function captureProcessChildrenMapSync(): ProcessChildrenMap | null {
  try {
    const result = spawnSync('ps', ['-eo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      maxBuffer: PROCESS_TREE_SCAN_MAX_BUFFER_BYTES,
      timeout: PROCESS_TREE_SCAN_TIMEOUT_MS,
    })
    if (result.error || result.status !== 0) return null
    return parseProcessChildrenMap(result.stdout)
  } catch {
    return null
  }
}

function readCurrentCommands(pids: readonly number[]): ProcessCommandMap | null {
  const uniquePids = [...new Set(pids.filter(pid => Number.isInteger(pid) && pid > 0))]
  if (uniquePids.length === 0) return new Map()
  try {
    const result = spawnSync('ps', ['-p', uniquePids.join(','), '-o', 'pid=,command='], {
      encoding: 'utf8',
      maxBuffer: PROCESS_COMMAND_SCAN_MAX_BUFFER_BYTES,
      timeout: PROCESS_TREE_SCAN_TIMEOUT_MS,
    })
    if (result.error) return null
    if (result.status !== 0) return new Map()
    return parseProcessCommandMap(result.stdout)
  } catch {
    return null
  }
}

function signalPid(pid: number, signal: TerminalKillSignal): void {
  try {
    process.kill(pid, signal)
  } catch {
    // ESRCH: already dead.
  }
}

export function createProcessTreeKiller(): ProcessTreeKiller {
  const capture = (rootPid: number): CapturedProcessTree => {
    if (!Number.isInteger(rootPid) || rootPid <= 0 || process.platform === 'win32') {
      return { descendants: [] }
    }
    const map = captureProcessChildrenMapSync()
    if (!map) return { descendants: [] }
    return { descendants: collectDescendantProcesses(rootPid, map) }
  }
  const signalCaptured = (
    rootPid: number,
    tree: CapturedProcessTree,
    signal: TerminalKillSignal,
  ): void => {
    if (!Number.isInteger(rootPid) || rootPid <= 0) return
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/pid', String(rootPid), '/t', '/f'], { timeout: 2000 })
      } catch {
        signalPid(rootPid, signal)
      }
      return
    }
    const currentCommands = readCurrentCommands(tree.descendants.map(d => d.pid))
    // Leaves first: reverse order so child exits before parent. Descendants
    // are signalled only when their command still matches the capture.
    for (const descendant of [...tree.descendants].reverse()) {
      if (currentCommands !== null && currentCommands.get(descendant.pid) === descendant.command) {
        signalPid(descendant.pid, signal)
      }
    }
    signalPid(rootPid, signal)
  }
  return {
    capture,
    signalCaptured,
    killTree: (rootPid, signal = 'SIGTERM') => {
      if (!Number.isInteger(rootPid) || rootPid <= 0) return
      signalCaptured(rootPid, capture(rootPid), signal)
    },
  }
}

export const defaultProcessTreeKiller: ProcessTreeKiller = createProcessTreeKiller()

/** A per-terminal kill-escalation slot (clear + replace the pending timer). */
export interface KillEscalationSlot {
  clear(): void
  /** Record the grace timer so a later dispose can cancel or await it. */
  set(timer: ReturnType<typeof setTimeout>): void
}

/**
 * Terminate a pty's process tree with the standard SIGTERM → grace → SIGKILL
 * escalation shared by the UI-tab and agent registries. After the
 * initial SIGTERM reaches the captured tree, a grace timer re-checks
 * `isExited`; if the process has not gone by then, the same captured tree is
 * SIGKILLed. Windows uses task-kill semantics inside the killer and never
 * escalates.
 *
 * @param pty - the live node-pty handle (its pid + kill).
 * @param graceMs - escalation delay (the registry policy's processKillGraceMs).
 * @param isExited - live check; the escalation is skipped once the process exited.
 * @param slot - the caller's kill-escalation bookkeeping (cleared before signal,
 *   and updated with the grace timer so teardown can cancel/await it).
 */
export function terminateProcessTreeWithGrace(
  pty: { pid: number; kill(): void },
  graceMs: number,
  isExited: () => boolean,
  slot: KillEscalationSlot,
): void {
  const pid = pty.pid
  if (!Number.isInteger(pid) || pid <= 0) {
    pty.kill()
    return
  }
  slot.clear()
  const capturedTree = defaultProcessTreeKiller.capture(pid)
  defaultProcessTreeKiller.signalCaptured(pid, capturedTree, 'SIGTERM')
  if (process.platform === 'win32') return
  const timer = setTimeout(() => {
    slot.clear()
    if (!isExited()) {
      defaultProcessTreeKiller.signalCaptured(pid, capturedTree, 'SIGKILL')
    }
  }, graceMs)
  timer.unref?.()
  slot.set(timer)
}