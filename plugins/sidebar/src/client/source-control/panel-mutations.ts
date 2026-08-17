/**
 * Source-control panel mutations (M3): the mutation dispatch hub, extracted
 * from the panel component. One place that knows which actions ride the
 * sidebar git API (checkout / commit) and which POST to the workspace host
 * route (stage / unstage / discard / branch / push / worktree …).
 */
import type { Translate } from '../../../../shared/i18n.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import { sidebarApi, type SidebarScope } from '../sidebar-api.ts'
import {
  WORKSPACE_API_PATH,
  type WorkspaceHostMutationResponse,
  type WorkspaceMutation,
} from '../../protocol.ts'

async function responseJson<T>(
  response: Response,
  t: Translate<WorkspaceMessage>,
): Promise<T> {
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) {
    throw new Error(payload.error ?? t('workspace.request-failed', {
      status: response.status,
    }))
  }
  return payload
}

function workspaceUrl(cwd: string): string {
  const url = new URL(WORKSPACE_API_PATH, window.location.origin)
  url.searchParams.set('cwd', cwd)
  return url.href
}

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
  try {
    if (mutation.action === 'checkout') {
      await sidebarApi.gitCheckout(scope, mutation.branch)
    } else if (mutation.action === 'commit') {
      await sidebarApi.gitStage(scope)
      await sidebarApi.gitCommit(scope, mutation.message)
      onCommitted()
    } else {
      const response = await fetch(workspaceUrl(cwd), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mutation),
      })
      await responseJson<WorkspaceHostMutationResponse>(response, t)
    }
    await refresh()
  } catch (cause) {
    reportError(cause instanceof Error ? cause.message : String(cause))
  }
}
