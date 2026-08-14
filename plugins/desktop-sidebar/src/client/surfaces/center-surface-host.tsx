/**
 * Center surface host: the middle-area tab strip + active surface body.
 *
 * Mounts a fixed overlay (`#oh-dsh-center-tabs-root`) spanning the center
 * column — between the DSH left sidebar (measured) and the desktop right
 * panel. Conversation tabs come from the sessions service (the current
 * project's sessions); file/diff/browser surfaces open as preview tabs
 * (single click replaces, double click pins).
 *
 * When a conversation tab is active the body is hidden so the DSH
 * conversation is visible; any other surface kind renders its body over
 * the center column.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Translate } from '../../../../shared/i18n.ts'
import { IconExternalLink, IconFile, IconGitBranch } from '../../../../shared/tabler-icons.tsx'
import type { WorkspaceMessage } from '../i18n.ts'
import type { SessionsService } from '../client-types.ts'
import {
  persistCenterSurfaces,
  restoreCenterSurfaces,
  useCenterSurfaceStore,
} from './center-surface-store.ts'
import {
  resolveActiveSurface,
  conversationSurfaceId,
  type CenterSurface,
} from './types.ts'
import {
  SurfaceTab,
  SurfaceTabStrip,
} from './surface-tab.tsx'
import {
  SurfaceRendererRegistry,
} from './surface-renderer-registry.tsx'
import {
  DiffThemeSync,
  DiffWorkerPoolProvider,
} from '../diff/pierre-adapter.tsx'

/** The one registry used by the desktop sidebar host. */
export const centerSurfaceRendererRegistry = new SurfaceRendererRegistry()

function surfaceIcon(surface: CenterSurface): JSX.Element | null {
  if (surface.kind === 'conversation') return <IconFile size={13} />
  if (surface.kind === 'file') return <IconFile size={13} />
  if (surface.kind === 'diff') return <IconGitBranch size={13} />
  if (surface.kind === 'browser') return <IconExternalLink size={13} />
  return null
}

function sessionShortId(sessionId: string): string {
  return `#${sessionId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase() || '?'}`
}

/** Human tab label for a conversation: project basename beats the raw id. */
function conversationTabTitle(sessionId: string, cwd: string | undefined): string {
  if (cwd !== undefined && cwd !== '') {
    const base = cwd.replaceAll('\\', '/').replace(/\/+$/, '').split('/').at(-1)
    if (base !== undefined && base !== '') return base
  }
  return sessionShortId(sessionId)
}

export function CenterSurfaceTabs({
  sessions,
  t,
}: {
  sessions: SessionsService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const slice = useCenterSurfaceStore(state => state.slice)
  const sessionList = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const current = sessionList.current

  // The current project's sessions (same cwd as the active session), the
  // current session included — it must show as the active tab, and the
  // "new conversation" blank placeholder is not a real tab.
  const conversationTabs = useMemo(() => {
    const cwd = current === undefined ? undefined : sessionList.byId[current]?.cwd
    if (cwd === undefined) return []
    return Object.entries(sessionList.byId)
      .filter(([id, summary]) => summary.cwd === cwd && !summary.blank)
      .map(([id, summary]) => ({ id, cwd: summary.cwd! }))
  }, [current, sessionList])

  const store = useCenterSurfaceStore.getState()

  // Keep the open set in sync with the session list: new sessions get a
  // tab (without stealing activation), removed sessions drop their tab,
  // and a dead/missing activeId falls back to the current conversation.
  useEffect(() => {
    const state = useCenterSurfaceStore.getState()
    const validIds = new Set(conversationTabs.map(tab => conversationSurfaceId(tab.id)))
    for (const tab of conversationTabs) {
      const id = conversationSurfaceId(tab.id)
      const exists = state.slice.open.some(surface => surface.id === id)
      if (!exists && !state.dismissedSessions.includes(tab.id)) {
        state.openConversation({
          sessionId: tab.id,
          cwd: tab.cwd,
          title: conversationTabTitle(tab.id, tab.cwd),
          activate: false,
        })
      }
    }
    for (const surface of state.slice.open) {
      if (surface.kind === 'conversation' && !validIds.has(surface.id)) {
        state.close(surface.id)
      }
    }
    const activeId = state.slice.activeId
    const activeExists = activeId !== null
      && state.slice.open.some(surface => surface.id === activeId)
    if (!activeExists && current !== undefined) {
      state.activate(conversationSurfaceId(current))
    }
  }, [conversationTabs, current])

  // Reopening a session from elsewhere (left rail click) restores its tab.
  useEffect(() => {
    if (current === undefined) return
    useCenterSurfaceStore.getState().undismissSession(current)
  }, [current])

  return (
    <SurfaceTabStrip aria-label={t('center.tablist')}>
      {slice.open.map(surface => {
        const isConversation = surface.kind === 'conversation'
        const label = isConversation
          ? conversationTabTitle(surface.sessionId, surface.cwd)
          : surface.title
        const active = slice.activeId === surface.id
        return (
          <SurfaceTab
            key={surface.id}
            label={label}
            title={isConversation ? surface.sessionId : (surface.kind === 'file' || surface.kind === 'diff' ? surface.filePath : surface.title)}
            icon={surfaceIcon(surface)}
            active={active}
            isPreview={!isConversation && surface.kind !== 'terminal' && surface.isPreview}
            closeLabel={t('center.close')}
            onSelect={() => {
              if (isConversation) {
                useCenterSurfaceStore.getState().openConversation({
                  sessionId: surface.sessionId,
                  cwd: surface.cwd,
                  title: conversationTabTitle(surface.sessionId, surface.cwd),
                })
                sessions.open(surface.sessionId)
              } else {
                useCenterSurfaceStore.getState().activate(surface.id)
              }
            }}
            {...(!isConversation && surface.kind !== 'terminal' && surface.isPreview
              ? { onPin: () => { store.pin(surface.id) } }
              : {})}
            onClose={() => {
              if (isConversation) {
                // Closing the tab hides it for this project until the
                // session is opened again — the session itself stays.
                useCenterSurfaceStore.getState().dismissSession(surface.sessionId)
              }
              useCenterSurfaceStore.getState().close(surface.id)
            }}
          />
        )
      })}
    </SurfaceTabStrip>
  )
}

export function CenterSurfaceBody(): JSX.Element {
  const slice = useCenterSurfaceStore(state => state.slice)
  const active = resolveActiveSurface(slice)
  const hidden = active === null || active.kind === 'conversation'
  let content: ReactNode = null
  if (active !== null && !hidden) {
    content = centerSurfaceRendererRegistry.render(active)
  }
  return (
    <div className="oh-dsh-center-surface-body" data-hidden={hidden || undefined}>
      {content ?? (
        <div className="oh-dsh-center-surface-empty">—</div>
      )}
    </div>
  )
}

/* ---------- mount / unmount ---------- */

export interface CenterSurfaceHostOptions {
  sessions: SessionsService
  t: Translate<WorkspaceMessage>
}

export class CenterSurfaceHost {
  private readonly sessions: SessionsService
  private readonly t: Translate<WorkspaceMessage>
  private root: Root | null = null
  private element: HTMLDivElement | null = null
  private attachObserver: MutationObserver | null = null
  private stopPersist: (() => void) | null = null

  constructor(options: CenterSurfaceHostOptions) {
    this.sessions = options.sessions
    this.t = options.t
  }

  mount(): void {
    if (this.element !== null) return
    this.element = document.createElement('div')
    this.element.id = 'oh-dsh-center-tabs-root'
    this.root = createRoot(this.element)
    this.root.render(
      <CenterSurfaceHostView sessions={this.sessions} t={this.t} />,
    )
    this.stopPersist = persistCenterSurfaces()
    restoreCenterSurfaces()
    this.attachToCenterColumn()
  }

  dispose(): void {
    this.attachObserver?.disconnect()
    this.attachObserver = null
    this.stopPersist?.()
    this.stopPersist = null
    this.root?.unmount()
    this.root = null
    this.element?.remove()
    this.element = null
    useCenterSurfaceStore.getState().clearAll()
  }

  /**
   * Mount the tab strip inside the DSH center column as a normal-flow flex
   * child (`.aOBRAa_centerCol` is a `flex-direction: column` container whose
   * only child is the `[data-slot="conversation"]` slot — we prepend next to
   * it, above the conversation, instead of overlaying the whole center area
   * with a fixed element).
   *
   * Normal flow removes every overlay problem: the strip never needs to
   * track the left-rail width (the column already sits between the rails),
   * a floating tooltip can no longer push it, and an active surface body
   * occupies the column in-flow (pushing the conversation out of view)
   * instead of painting on top of it.
   *
   * The DSH layout mounts asynchronously and re-renders its tree, so a
   * MutationObserver re-attaches the node if it is ever missing.
   */
  private attachToCenterColumn(): void {
    const attach = (): boolean => {
      if (this.element === null) return false
      const column = centerColumnElement()
      if (column === null) return false
      if (this.element.parentElement === column) return true
      column.prepend(this.element)
      return true
    }
    if (attach()) return
    this.attachObserver = new MutationObserver(() => { attach() })
    if (document.body !== null) {
      this.attachObserver.observe(document.body, {
        childList: true,
        subtree: true,
      })
    }
  }
}

/**
 * The DSH center column: the flex-column container that holds the
 * conversation slot (`[data-slot="conversation"]` sits inside it, next to
 * the sidebar column). Prefer the slot's parent so we do not depend on the
 * obfuscated class name; fall back to the class when the slot is absent.
 */
function centerColumnElement(): HTMLElement | null {
  const conversationSlot = document.querySelector('[data-slot="conversation"]')
  if (conversationSlot?.parentElement instanceof HTMLElement) {
    return conversationSlot.parentElement
  }
  const fallback = document.querySelector<HTMLElement>('.aOBRAa_centerCol')
  return fallback
}

function CenterSurfaceHostView({
  sessions,
  t,
}: {
  sessions: SessionsService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return <></>
  return (
    <DiffWorkerPoolProvider>
      <DiffThemeSync />
      <div className="oh-dsh-center-tabs-strip">
        <CenterSurfaceTabs sessions={sessions} t={t} />
      </div>
      <CenterSurfaceBody />
    </DiffWorkerPoolProvider>
  )
}

// Re-exported for callers that need the store actions directly.
export { useCenterSurfaceStore }
export type { CenterSurface }
export { persistCenterSurfaces, restoreCenterSurfaces } from './center-surface-store.ts'
