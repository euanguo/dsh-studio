/**
 * Terminal instance registry (ported from synara's scoped runtime registry
 * pattern): tracks terminal identity PER PROJECT (cwd) and gives each
 * terminal a stable leaf/pane key. The sidebar is project-dimension, so a
 * terminal opened in one conversation of a project is the SAME instance in
 * every conversation of that project — switching conversations never
 * re-spawns shells. The actual xterm/socket owner lives in the shared
 * module-level terminal runtime registry and survives React surface detach;
 * explicit close releases both the owner and the quota entry.
 */
import { ScopedRuntimeRegistry } from '@dsh-studio/shared/runtime'
import {
  createTerminalLeafId,
  makePaneKey,
  type PaneKey,
  type TerminalLeafId,
} from '@dsh-studio/shared/stable-pane-id'
import type { SidebarScope } from '../contract.ts'

export const MAX_TERMINAL_INSTANCES_PER_WORKSPACE = 64

interface TerminalRuntimeOwnerBridge {
  dispose(cwd: string, tabId: string): void
}

function disposeTerminalOwner(cwd: string, tabId: string): void {
  const bridge = (globalThis as typeof globalThis & {
    __dshStudioTerminalRuntimeOwner?: TerminalRuntimeOwnerBridge
  }).__dshStudioTerminalRuntimeOwner
  bridge?.dispose(cwd, tabId)
}

export interface TerminalInstanceInfo {
  tabId: string
  cwd: string
  createdAt: number
  leafId: TerminalLeafId
  paneKey: PaneKey
}

export function terminalInstanceKey(scope: SidebarScope, tabId: string): string {
  return `${scope.cwd}:${tabId}`
}

export const terminalInstanceRegistry = new ScopedRuntimeRegistry<TerminalInstanceInfo>({
  maxEntries: MAX_TERMINAL_INSTANCES_PER_WORKSPACE * 2,
})

export function terminalInstanceCount(scope: SidebarScope): number {
  return terminalInstanceRegistry.values().filter(instance =>
    instance.cwd === scope.cwd,
  ).length
}

export function canOpenTerminalInstance(scope: SidebarScope): boolean {
  return terminalInstanceCount(scope) < MAX_TERMINAL_INSTANCES_PER_WORKSPACE
}

export function releaseTerminalInstance(scope: SidebarScope, tabId: string): void {
  disposeTerminalOwner(scope.cwd, tabId)
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
      cwd,
      createdAt: Date.now(),
      leafId,
      paneKey: makePaneKey(encodeURIComponent(tabId), leafId),
    }
  })
}
