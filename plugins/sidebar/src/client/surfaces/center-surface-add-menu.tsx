/**
 * The center strip's "+" menu: opens browser / terminal / new conversation
 * as first-class surfaces — plain click opens in the CENTER, holding Alt
 * opens in the RIGHT RAIL instead (a new terminal/browser tab there). A
 * new conversation always starts a fresh blank session (the project
 * header's "new chat" behavior), which lives in the center by nature.
 */
import {
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import {
  IconExternalLink,
  IconPlus,
  IconTerminal,
} from '@dsh-studio/shared/tabler-icons'
import { ToolbarAction, useMenuAnchor } from '@dsh-studio/shared/ui'
import type { SessionsService, WorkspacesService } from '../client-types.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import { workbenchOpen } from '../open/pipeline.ts'
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import type { DesktopSidebarServiceLike } from './center-surface-host.tsx'

export function CenterAddMenu({
  sessions,
  sidebar,
  workspaces,
  t,
}: {
  sessions: SessionsService
  sidebar: DesktopSidebarServiceLike
  workspaces: WorkspacesService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const { open, toggle, close, anchorRef, getAnchorRect } = useMenuAnchor()
  const [altDown, setAltDown] = useState(false)
  // While the menu is open, track the Alt modifier (Alt+click = right rail);
  // it resets on close / blur so a stale modifier never leaks.
  useEffect(() => {
    if (!open) return
    setAltDown(false)
    const keydown = (event: KeyboardEvent): void => { if (event.key === 'Alt') setAltDown(true) }
    const keyup = (event: KeyboardEvent): void => { if (event.key === 'Alt') setAltDown(false) }
    const clear = (): void => { setAltDown(false) }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', clear)
    }
  }, [open])
  // Identity reactivity rides the runtime's current-session projection
  // (leaf-1.7); the roster itself is read fresh at render.
  useSyncExternalStore(sessions.currentProvideInfo.subscribe, sessions.currentProvideInfo.getSnapshot)
  const sessionList = sessions.list.getSnapshot()
  const current = sessionList.current
  // The active workspace: use the current session cwd, or fallback to the
  // first non-blank session with a cwd, or "/".
  const currentSummary = current === undefined ? undefined : sessionList.byId[current]
  const cwd = ((currentSummary?.cwd && currentSummary.cwd.trim() !== '')
    ? currentSummary.cwd
    : Object.values(sessionList.byId).find(s => s.cwd && s.cwd.trim() !== '' && !s.blank)?.cwd) ?? '/'
  const items: MenuEntry[] = [
    {
      id: 'browser',
      label: t('browser'),
      icon: <IconExternalLink size={14} />,
    },
    {
      id: 'terminal',
      label: t('terminal'),
      icon: <IconTerminal size={14} />,
    },
    { id: 'new-conversation', label: t('add.new-conversation'), icon: <IconPlus size={14} /> },
  ]
  const pick = (id: string): void => {
    close()
    if (id === 'browser') {
      const targetCwd = (typeof cwd === 'string' && cwd.trim() !== '') ? cwd : '/'
      if (altDown) {
        // Alt = the RIGHT RAIL chip instead of a center tab; rail tabs join
        // the surface registry in the registry-unification leaf.
        sidebar.openTab({ type: 'browser' })
        sidebar.setOpen(true)
        return
      }
      workbenchOpen().open({
        kind: 'browser',
        target: { cwd: targetCwd },
        intent: 'pin',
        title: t('browser'),
      })
      return
    }
    if (id === 'terminal') {
      const targetCwd = (typeof cwd === 'string' && cwd.trim() !== '') ? cwd : '/'
      if (altDown) {
        sidebar.openTab({ type: 'terminal' })
        sidebar.setOpen(true)
        return
      }
      // One fresh terminal instance per open; the per-workspace instance cap
      // is enforced by the dispatcher (see client/open/pipeline.ts).
      workbenchOpen().open({
        kind: 'terminal',
        target: { cwd: targetCwd },
        intent: 'pin',
        title: t('terminal'),
      })
      return
    }
    // New conversation: a fresh blank session in the center (same as the
    // project header's "new chat").
    workspaces.startSession()
  }
  return (
    <div className={surfaceCss["dsh-studio-center-add"]}>
      <ToolbarAction
        ref={anchorRef}
        variant="ghost"
        className="dsh-studio-center-add-trigger"
        icon={<IconPlus size={14} />}
        label={t('add.open')}
        aria-expanded={open}
        onClick={toggle}
      />
      <Menu
        open={open}
        anchor={null}
        align="end"
        items={items}
        portal
        getAnchorRect={getAnchorRect}
        onSelect={pick}
        onClose={close}
      />
    </div>
  )
}