/**
 * Terminal instance registry (ported from synara's scoped runtime registry
 * pattern): tracks terminal identity per session and gives each terminal a
 * stable leaf/pane key. The actual xterm/socket owner lives in the shared
 * module-level terminal runtime registry and survives React surface detach;
 * explicit close releases both the owner and the quota entry.
 */
import { ScopedRuntimeRegistry } from '@oh-dsh/shared/runtime'
import {
  createTerminalLeafId,
  makePaneKey,
  type PaneKey,
  type TerminalLeafId,
} from '@oh-dsh/shared/stable-pane-id'
import type { SidebarScope } from '../contract.ts'

export const MAX_TERMINAL_INSTANCES_PER_SESSION = 64

interface TerminalRuntimeOwnerBridge {
  dispose(sessionId: string, tabId: string): void
}

function disposeTerminalOwner(sessionId: string, tabId: string): void {
  const bridge = (globalThis as typeof globalThis & {
    __ohDshTerminalRuntimeOwner?: TerminalRuntimeOwnerBridge
  }).__ohDshTerminalRuntimeOwner
  bridge?.dispose(sessionId, tabId)
}

export interface TerminalInstanceInfo {
  tabId: string
  sessionId: string
  cwd: string
  createdAt: number
  leafId: TerminalLeafId
  paneKey: PaneKey
}

export function terminalInstanceKey(scope: SidebarScope, tabId: string): string {
  return `${scope.sessionId}:${scope.cwd}:${tabId}`
}

export const terminalInstanceRegistry = new ScopedRuntimeRegistry<TerminalInstanceInfo>({
  maxEntries: MAX_TERMINAL_INSTANCES_PER_SESSION * 2,
})

export function terminalInstanceCount(scope: SidebarScope): number {
  return terminalInstanceRegistry.values().filter(instance =>
    instance.sessionId === scope.sessionId && instance.cwd === scope.cwd,
  ).length
}

export function canOpenTerminalInstance(scope: SidebarScope): boolean {
  return terminalInstanceCount(scope) < MAX_TERMINAL_INSTANCES_PER_SESSION
}

export function releaseTerminalInstance(scope: SidebarScope, tabId: string): void {
  disposeTerminalOwner(scope.sessionId, tabId)
  terminalInstanceRegistry.delete(terminalInstanceKey(scope, tabId))
}

export function touchTerminalInstance(scope: SidebarScope, tabId: string): TerminalInstanceInfo {
  if (scope.cwd === undefined || scope.cwd === '') {
    throw new Error('terminal instance scope requires a workspace cwd')
  }
  const key = terminalInstanceKey(scope, tabId)
  const cwd = scope.cwd
  return terminalInstanceRegistry.getOrCreate(key, () => {
    const leafId = createTerminalLeafId()
    return {
      tabId,
      sessionId: scope.sessionId,
      cwd,
      createdAt: Date.now(),
      leafId,
      paneKey: makePaneKey(encodeURIComponent(tabId), leafId),
    }
  })
}