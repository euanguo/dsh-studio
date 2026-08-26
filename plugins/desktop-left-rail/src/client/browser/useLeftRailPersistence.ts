/**
 * All persistence for the workspace browser: hydration from the settings and
 * chrome stores, debounced/CAS settings writes with an unmount flush, the
 * chrome save effect, and the retained-account-keys effect that keeps stale
 * group-expansion / session-order keys from accumulating. Self-managing: it
 * needs nothing back from the renderer.
 */
import { useEffect, useRef } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { LeftRailViewChrome } from '@dsh-studio/shared/ui-chrome-tables'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { SessionOrderBy, WorktreeLayoutMap } from '../tree.ts'
import { FLAT_SESSION_ORDER_KEY, type SessionGroupBy } from '../stores.ts'
import type { ProjectIconPreference } from '../domain/project-icon.ts'
import {
  repoExpansionKey, UNGROUPED_EXPANSION_KEY, UNGROUPED_KEY,
  workspaceExpansionKey, worktreeExpansionKey,
} from '../tree.ts'
import { loadLeftRailChrome, flushLeftRailChrome, saveLeftRailChrome } from '../left-rail-chrome.ts'
import { loadLeftRailSettings, startLeftRailSettingsPersistence, type LeftRailSettings } from '../left-rail-settings.ts'
import { toast } from '@dsh-studio/shared/toast'

/** Debounce before a whole-slice settings write (matches the chrome store's own 300ms). */
const SETTINGS_SAVE_DEBOUNCE_MS = 300

export interface LeftRailViewSlice {
  activeTab: string
  projectGroup: Record<string, string>
  groupIds: string[]
  groupLabels: Record<string, string>
  projectAlias: Record<string, string>
  worktreeAlias: Record<string, string>
  projectIconOverrides: Record<string, ProjectIconPreference>
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  groupExpansion: Record<string, boolean>
  sessionOrderByAccount: Record<string, string[]>
}

export function useLeftRailPersistence({
  actions,
  view,
  workspaces,
  workspacePhase,
  layouts,
  t,
}: {
  actions: {
    hydrateGrouping: (settings: LeftRailSettings) => void
    hydrateChrome: (chrome: LeftRailViewChrome) => void
    retainAccountKeys: (keys: readonly string[]) => void
  }
  view: LeftRailViewSlice
  workspaces: readonly WorkspaceView[]
  workspacePhase: string
  layouts: WorktreeLayoutMap
  t: WorkspaceBrowserProps['t']
}): void {
  // Last-known server slice: the browser owns ONLY the view fields below, so
  // every save merges them over this base — and each write diffs against a
  // FRESH read inside the settings backend, so keys owned by other surfaces
  // compare equal and ride untouched instead of being deleted/reverted.
  const settingsSlice = useRef<LeftRailSettings>({})
  const settingsHydrated = useRef(false)
  // The latest whole-section writer, kept current every render so a debounced
  // save or an unmount flush always persists the freshest view fields.
  const buildSettingsSlice = useRef((base: LeftRailSettings): LeftRailSettings => base)
  buildSettingsSlice.current = (base) => ({
    ...base,
    activeTab: view.activeTab, projectGroup: view.projectGroup, groupIds: view.groupIds,
    groupLabels: view.groupLabels, projectAlias: view.projectAlias, worktreeAlias: view.worktreeAlias,
    projectIconOverrides: view.projectIconOverrides,
  })
  const chromeHydrated = useRef(false)
  // One persistVia-driven settings pump per mount: debounced view saves and
  // the unmount flush both snapshot through it, and write failures surface
  // through its callback (same toast as before the unification).
  const settingsPump = useRef<ReturnType<typeof startLeftRailSettingsPersistence> | undefined>(undefined)
  useEffect(() => {
    const pump = startLeftRailSettingsPersistence({
      onWriteFailed: () => { toast(t('settings.worktree.saveFailed')) },
    })
    settingsPump.current = pump
    return () => { pump.stop() }
  }, [t])

  useEffect(() => {
    let cancelled = false
    loadLeftRailSettings().then((view) => {
      if (cancelled) return
      settingsSlice.current = view.value
      actions.hydrateGrouping(view.value)
      settingsHydrated.current = true
    }).catch(() => {
      if (!cancelled) settingsHydrated.current = true
    })
    return () => { cancelled = true }
  }, [actions.hydrateGrouping])

  useEffect(() => {
    let cancelled = false
    loadLeftRailChrome().then((chrome) => {
      if (cancelled) return
      chromeHydrated.current = true
      actions.hydrateChrome(chrome)
    }).catch((error: unknown) => {
      // Hydration failed: leave chromeHydrated false so the save-back effect
      // stays off — persisting current memory now would overwrite the store.
      console.warn('[left-rail] chrome hydrate failed; persistence paused', error)
    })
    return () => { cancelled = true }
  }, [actions.hydrateChrome])

  useEffect(() => () => { void flushLeftRailChrome() }, [])

  useEffect(() => {
    if (!chromeHydrated.current) return
    saveLeftRailChrome({
      groupBy: view.groupBy,
      orderBy: view.orderBy,
      groupExpansion: view.groupExpansion,
      sessionOrder: view.sessionOrderByAccount,
    })
  }, [view.groupBy, view.groupExpansion, view.orderBy, view.sessionOrderByAccount])

  useEffect(() => {
    if (!settingsHydrated.current) return
    const timer = window.setTimeout(() => {
      // Whole-section CAS persistence with one self-healing retry, queued
      // through the persistVia settings pump (see startLeftRailSettingsPersistence).
      settingsPump.current?.write(buildSettingsSlice.current(settingsSlice.current))
    }, SETTINGS_SAVE_DEBOUNCE_MS)
    return () => { window.clearTimeout(timer) }
  }, [view.activeTab, view.projectGroup, view.groupIds, view.groupLabels,
    view.projectAlias, view.worktreeAlias, view.projectIconOverrides])

  useEffect(() => {
    // Unmount flush: the debounce above is cleared on unmount, so its pending
    // write would be lost; persist the freshest slice now instead.
    return () => {
      if (!settingsHydrated.current) return
      void settingsPump.current?.flush()
    }
  }, [])

  useEffect(() => {
    if (workspacePhase !== 'ready') return
    // Retain the session-order accounts (workspace ids + ungrouped/flat) and
    // the namespaced expansion keys so stale keys never accumulate.
    const retain = new Set<string>([UNGROUPED_KEY, FLAT_SESSION_ORDER_KEY, UNGROUPED_EXPANSION_KEY])
    for (const workspace of workspaces) {
      retain.add(workspace.workspaceId as string)
      retain.add(workspaceExpansionKey(workspace.workspaceId as string))
      const layout = layouts.get(workspace.path)
      if (layout !== null && layout !== undefined) {
        retain.add(repoExpansionKey(layout.repoRoot))
        for (const wt of layout.worktrees) retain.add(worktreeExpansionKey(wt.path))
      } else {
        retain.add(repoExpansionKey(workspace.path))
      }
    }
    actions.retainAccountKeys([...retain])
  }, [actions.retainAccountKeys, workspacePhase, workspaces, layouts])
}