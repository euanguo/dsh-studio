/**
 * Center surface tab strip: the project's conversation tabs and the
 * file/diff/browser/terminal surfaces open as preview or pinned tabs.
 * Split from center-surface-host.tsx.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import type { SessionsService } from '../client-types.ts'
import { sidebarApi } from '../sidebar-api.ts'
import { SurfaceTab, SurfaceTabStrip } from '@dsh-studio/shared/ui'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { useTabStripDrag } from '../use-tab-strip-drag.ts'
import {
  releaseTerminalInstance,
} from '../runtimes/terminal-runtime.ts'
import type {
  CenterSurfaceSlice,
} from './types.ts'
import {
  currentConversationSyncAction,
  conversationPosture,
  resolveCenterWorkspace,
  retainConversationSurface,
  type CenterWorkspace,
} from './center-surface-sync.ts'
import { conversationSurfaceId } from './types.ts'
import { useCenterSurfaceStore } from './center-surface-store.ts'
import {
  conversationTabTitle,
  EMPTY_CENTER_SLICE,
  surfaceIcon,
} from './center-surface-meta.tsx'
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'


export function CenterSurfaceTabs({
  sessions,
  t,
}: {
  sessions: SessionsService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  // Identity reactivity rides the runtime's current-session projection
  // (leaf-1.7): a selection switch (navigate within the project) or a
  // provider-roster change re-renders; the roster itself is read fresh at
  // render and the retain/activate/deactivate sync below maps the two kernel
  // identity event classes onto the open set.
  useSyncExternalStore(sessions.currentProvideInfo.subscribe, sessions.currentProvideInfo.getSnapshot)
  const sessionList = sessions.list.getSnapshot()
  const workspace = resolveCenterWorkspace(sessionList)
  const current = workspace.status === 'ready' ? workspace.sessionId : undefined
  const cwd = workspace.status === 'ready' ? workspace.cwd : undefined
  const slice = useCenterSurfaceStore(state =>
    cwd === undefined ? EMPTY_CENTER_SLICE : state.getSlice(cwd))
  const queueKnown = useCenterSurfaceStore(state =>
    cwd !== undefined && state.byCwd[cwd] !== undefined)

  // Center-strip tab drag: reorder the workspace's open surfaces within the
  // queue (project dimension — same unified reorder model).
  const drag = useTabStripDrag({
    source: 'center',
    onDrop: (payload, hoverId, side) => {
      if (cwd === undefined) return
      useCenterSurfaceStore.getState().reorderSurfaces(
        cwd,
        payload.tabId,
        hoverId === '' ? null : hoverId,
        side,
      )
    },
  })

  // The current project's sessions (same cwd as the active session), the
  // current session included — it must show as the active tab, and the
  // "new conversation" blank placeholder is not a real tab. Subagent
  // children never become tabs (the left rail's sessionVisible rule);
  // they live in the parent's subagent panel instead.
  const conversationTabs = useMemo(() => {
    if (cwd === undefined) return []
    return Object.entries(sessionList.byId)
      .filter(([id, summary]) => summary.cwd?.trim() === cwd
        && !summary.blank
        && summary.origin !== 'subagent')
      .map(([id, summary]) => ({ id, cwd: cwd!, summary }))
  }, [cwd, sessionList])

  // Keep the open set in sync with the session list WITHOUT re-listing every
  // project conversation: a conversation is an ordinary center tab, so the
  // open set is a WHITELIST — restore brings back only what the user had
  // open (never all of the project's sessions), and closing a tab persists
  // its removal. The one guarantee: NAVIGATING within the SAME project (the
  // active session changed while the cwd did not — a left-rail click, a
  // session switch, a fork/new) opens that conversation's tab, exactly like
  // clicking a file opens a file tab. Entering/returning to a project
  // (cwd changed) is a RESTORE, not a navigation: only the persisted open[]
  // whitelist comes back, so a conversation the user closed before leaving
  // the project stays closed. Removed sessions drop their tab.
  const previousWorkspaceRef = useRef<Extract<CenterWorkspace, { status: 'ready' }> | undefined>(undefined)
  useEffect(() => {
    if (workspace.status !== 'ready') return
    const state = useCenterSurfaceStore.getState()
    const before = state.getSlice(workspace.cwd)
    const validIds = new Set(conversationTabs.map(tab => conversationSurfaceId(tab.id)))
    const currentId = conversationSurfaceId(workspace.sessionId)
    const currentTabOpen = before.open.some(surface => surface.id === currentId)
    const activeSurfaceExists = before.activeId !== null
      && before.open.some(surface => surface.id === before.activeId)
    const syncAction = currentConversationSyncAction({
      current: workspace,
      previous: previousWorkspaceRef.current,
      queueKnown,
      currentTabOpen,
      activeSurfaceExists,
    })
    state.ensureCwd(workspace.cwd)
    if (syncAction === 'open') {
      state.openConversation({
        cwd: workspace.cwd,
        sessionId: workspace.sessionId,
        title: conversationTabTitle(workspace.sessionId, workspace.cwd, workspace.summary),
        activate: true,
      })
    } else if (syncAction === 'activate') {
      state.activate(workspace.cwd, currentId)
    } else if (workspace.summary.blank === true) {
      // The new-conversation placeholder owns the center stage: its workspace
      // tabs stay listed, none is highlighted, and the conversation (hero)
      // shows instead of whatever surface was active.
      state.deactivate(workspace.cwd)
    }
    const afterOpen = useCenterSurfaceStore.getState().getSlice(workspace.cwd)
    for (const surface of afterOpen.open) {
      if (surface.kind === 'conversation'
        && !validIds.has(surface.id)
        && !retainConversationSurface({
          cwd: workspace.cwd,
          sessionId: surface.sessionId,
          list: sessionList,
        })) {
        useCenterSurfaceStore.getState().close(workspace.cwd, surface.id)
      }
    }
    const afterCleanup = useCenterSurfaceStore.getState().getSlice(workspace.cwd)
    if (afterCleanup.activeId === null && currentTabOpen && workspace.summary.blank !== true) {
      useCenterSurfaceStore.getState().activate(workspace.cwd, currentId)
    }
    previousWorkspaceRef.current = workspace
  }, [conversationTabs, queueKnown, sessionList, workspace])

  return (
    <SurfaceTabStrip
      aria-label={t('center.tablist')}
      {...drag.strip.handlers}
    >
      {slice.open.map(surface => {
        const isConversation = surface.kind === 'conversation'
        const summary = isConversation
          ? sessionList.byId[surface.sessionId]
          : undefined
        const label = isConversation
          ? conversationTabTitle(surface.sessionId, surface.cwd, summary)
          : surface.title
        const active = slice.activeId === surface.id
        const dropClass = drag.chip.markerClass(surface.id)
        // A postured conversation swaps its dialogue icon for the official
        // StateDot (left-rail parity); idle conversations keep the icon.
        const posture = isConversation ? conversationPosture(summary) : undefined
        return (
          <SurfaceTab
            key={surface.id}
            label={label}
            title={isConversation ? surface.sessionId : (surface.kind === 'file' || surface.kind === 'diff' || surface.kind === 'commit-file' ? surface.filePath : surface.title)}
            icon={posture !== undefined
              ? <StateDot state={posture} />
              : surfaceIcon(surface)}
            active={active}
            {...(dropClass === undefined ? {} : { className: dropClass })}
            isPreview={!isConversation && surface.kind !== 'terminal' && surface.isPreview}
            closeLabel={t('center.close')}
            tabId={surface.id}
            draggable={drag.chip.handlers.draggable}
            onDragStart={event => { drag.chip.handlers.onDragStart(event, surface.id, label) }}
            onDragEnter={event => { drag.chip.handlers.onDragEnter(event, surface.id) }}
             onDragOver={event => { drag.chip.handlers.onDragOver(event, surface.id) }}
            onDrop={event => { drag.chip.handlers.onDrop(event, surface.id) }}
            onDragEnd={drag.chip.handlers.onDragEnd}
            onSelect={() => {
              if (isConversation) {
                useCenterSurfaceStore.getState().openConversation({
                  cwd: surface.cwd,
                  sessionId: surface.sessionId,
                  title: conversationTabTitle(surface.sessionId, surface.cwd, summary),
                })
                sessions.open(surface.sessionId)
              } else {
                useCenterSurfaceStore.getState().activate(cwd!, surface.id)
              }
            }}
            {...(!isConversation && surface.kind !== 'terminal' && surface.isPreview
              ? { onPin: () => { useCenterSurfaceStore.getState().pin(cwd!, surface.id) } }
              : {})}
            onClose={() => {
              // Closing ANY tab (conversation included) removes it from the
              // open set — a conversation tab is just a tab: the session
              // itself is untouched and stays in the session list (reopen it
              // from the left rail and the tab returns).
              if (surface.kind === 'terminal' && cwd !== undefined) {
                releaseTerminalInstance({ cwd }, surface.id)
                void sidebarApi.ptyClose({ cwd }, surface.id)
              }
              useCenterSurfaceStore.getState().close(cwd!, surface.id)
            }}
          />
        )
      })}
    </SurfaceTabStrip>
  )
}