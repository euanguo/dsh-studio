/**
 * Keeps each Workspace's session-order account synchronized with the host's
 * membership and derives the recency-sorted `orderedWorkspaces` the tree and
 * list render from. Encapsulates the previousOrderBy ref + nextSessionOrderAccount
 * effect and the orderedWorkspaceViews projection (sort-by-recency C9 stays intact).
 */
import { useEffect, useMemo, useRef } from 'react'
import type { SessionListState, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionOrderBy } from '../tree.ts'
import { nextSessionOrderAccount, orderedWorkspaceViews } from '../session-order.ts'

export function useSessionOrderAccounts({
  workspaces,
  sessionList,
  workspacePhase,
  orderBy,
  sessionOrderByAccount,
  sessionUpdatedAtByAccount,
  syncSessionOrderAccount,
}: {
  workspaces: readonly WorkspaceView[]
  sessionList: SessionListState
  workspacePhase: string
  orderBy: SessionOrderBy
  sessionOrderByAccount: Record<string, string[]>
  sessionUpdatedAtByAccount: Record<string, Record<string, number>>
  syncSessionOrderAccount: (accountKey: string, order: string[], updatedAt: Record<string, number>) => void
}): WorkspaceView[] {
  const previousOrderBy = useRef(orderBy)
  useEffect(() => {
    if (workspacePhase !== 'ready' || sessionList.phase !== 'ready') return
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    const switchedToManual = previousOrderBy.current === 'updated' && orderBy === 'manual'
    previousOrderBy.current = orderBy
    for (const workspace of workspaces) {
      const sessionIds = workspace.sessionIds.filter(id => sessionList.byId[id] !== undefined)
      const key = workspace.workspaceId as string
      const next = nextSessionOrderAccount({
        sessionIds,
        previousOrder: switchedToManual ? undefined : sessionOrderByAccount[key],
        previousUpdatedAt: switchedToManual ? {} : sessionUpdatedAtByAccount[key] ?? {},
        list: sessionList,
        orderBy,
        sortByRecency: orderBy === 'updated'
          && (sessionOrderByAccount[key] === undefined || switchedToUpdated),
      })
      if (next.changed) {
        syncSessionOrderAccount(key, next.order.map(id => id as string), next.updatedAt)
      }
    }
  }, [syncSessionOrderAccount, orderBy, sessionList, sessionOrderByAccount,
    sessionUpdatedAtByAccount, workspacePhase, workspaces])
  return useMemo(
    () => orderedWorkspaceViews(workspaces, sessionOrderByAccount),
    [sessionOrderByAccount, workspaces],
  )
}