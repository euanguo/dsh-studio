/**
 * Source-control panel mutations (M3): the mutation dispatch hub, extracted
 * from the panel component. One place that knows which actions ride the
 * session-scoped git methods (checkout / stage / commit) and which go
 * through the workspace-scoped workspace.mutate method (branch / push) —
 * all through the single /sidebar/api channel behind one trust fence.
 */
import type { Translate } from '../../../../shared/i18n.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import { sidebarApi, type SidebarScope } from '../sidebar-api.ts'
import type { WorkspaceMutation } from '../../protocol.ts'

export interface PanelMutationHooks {
  /** Called after a successful commit (the draft message is consumed). */
  onCommitted(): void
  /** Called after every successful mutation (refresh panel state). */
  refresh(): Promise<void>
  /** Called with the failure message (surfaced in the panel). */
  reportError(message: string): void
}

/** Run one panel mutation; success refreshes, failure reports. */
export async function runPanelMutation(
  mutation: WorkspaceMutation,
  hooks: {
    scope: SidebarScope
    cwd: string
    t: Translate<WorkspaceMessage>
  } & PanelMutationHooks,
): Promise<void> {
  const { scope, cwd, t, onCommitted, refresh, reportError } = hooks
  void t
  try {
    if (mutation.action === 'checkout') {
      await sidebarApi.gitCheckout(scope, mutation.branch)
    } else if (mutation.action === 'commit') {
      await sidebarApi.gitStage(scope)
      await sidebarApi.gitCommit(scope, mutation.message)
      onCommitted()
    } else {
      // create-branch / push: workspace-scoped, keyed on the bare cwd.
      // Wire errors (not a repo, no remote, detached HEAD…) arrive through
      // the shared envelope and surface via reportError below.
      await sidebarApi.workspaceMutate(cwd, mutation)
    }
    await refresh()
  } catch (cause) {
    reportError(cause instanceof Error ? cause.message : String(cause))
  }
}
