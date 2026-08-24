/**
 * The left rail's Settings shell section: the durable Project/WorkTree
 * location preferences (store directory override + repo-name nesting),
 * persisted through the same `dsh-studio-left-rail` namespace the browser
 * hydrates from. The component owns only a draft + CAS revision; the HOST
 * remains the resolution authority (`git.worktree-defaults` folds the
 * override and the data-root default into the root the dialog consumes).
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import {
  loadLeftRailSettings,
  saveLeftRailSettings,
  type LeftRailSettings,
  type LeftRailSettingsView,
} from './left-rail-settings.ts'
import { fetchWorktreeDefaults } from './worktree-api.ts'
import { sanitizeWorktreeDir, type WorktreeDefaultsResult } from '@dsh-studio/shared/worktree-preferences'
import { FieldError, SettingsRow, SettingsSection, Switch } from '@dsh-studio/shared/ui'
import { SettingsSectionCss as css } from './styles.ts'

type SectionTranslate = WorkspaceBrowserProps['t']

/** Props of the settings section component (the shell's owner share + locale seat). */
export type WorktreeSettingsSectionProps = {
  /** Close the settings panel (shell affordance; unused by this section). */
  close: () => void
  /** The left-rail locale seat. */
  t: SectionTranslate
}

/**
 * Edit the worktree location preferences: one directory input (empty = the
 * data-root default shown as placeholder) and one nesting switch. Saves are
 * whole-section replaces with CAS, so a concurrent browser save (view state)
 * surfaces here as a conflict and vice versa — one retry over the fresh
 * slice resolves it without deleting either side's keys.
 */
export function WorktreeSettingsSection({ t }: WorktreeSettingsSectionProps) {
  const [slice, setSlice] = useState<LeftRailSettingsView | null>(null)
  const [defaults, setDefaults] = useState<WorktreeDefaultsResult | null>(null)
  const [dirDraft, setDirDraft] = useState<string>('')
  const [nest, setNest] = useState<boolean>(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedOnce, setLoadedOnce] = useState(false)
  // Latest loaded view for the commit base; updated by every load/save so a
  // commit never resurrects keys another surface changed in between.
  const viewRef = useRef<LeftRailSettingsView | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const [view, hostDefaults] = await Promise.all([
          loadLeftRailSettings(),
          fetchWorktreeDefaults().catch(() => null),
        ])
        if (cancelled) return
        viewRef.current = view
        setSlice(view)
        setDefaults(hostDefaults)
        setDirDraft(view.value.worktreeDir ?? '')
        setNest(view.value.nestWorktrees ?? true)
      } catch {
        if (!cancelled) setError(t('settings.worktree.loadFailed'))
      } finally {
        if (!cancelled) setLoadedOnce(true)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [t])

  const custom = slice?.value.worktreeDir !== undefined
  const effectiveRoot = defaults?.root
  const dirDirty = loadedOnce && (slice === null || sanitizeWorktreeDir(dirDraft) !== slice.value.worktreeDir)
  const nestDirty = loadedOnce && slice !== null && nest !== (slice.value.nestWorktrees ?? true)

  /** Build the next slice: view fields ride the loaded base; an empty/invalid
   * draft OMITS worktreeDir (replace expresses deletion → data-root default). */
  const buildNext = (base: LeftRailSettings, dir: string | undefined, nestValue: boolean): LeftRailSettings => {
    const { worktreeDir: _omit, ...rest } = base
    return {
      ...rest,
      ...(dir === undefined ? {} : { worktreeDir: dir }),
      nestWorktrees: nestValue,
    }
  }

  /** Persist the current draft as the next slice (view fields ride the loaded base). */
  const commit = async (): Promise<void> => {
    if (viewRef.current === null) return
    if (!dirDirty && !nestDirty) return
    const dir = sanitizeWorktreeDir(dirDraft)
    const next = buildNext(viewRef.current.value, dir, nest)
    setSaving(true)
    setError(null)
    try {
      const view = await saveLeftRailSettings(next, viewRef.current.revision)
      viewRef.current = view
      setSlice(view)
      setDirDraft(view.value.worktreeDir ?? '')
      setNest(view.value.nestWorktrees ?? true)
      // The host resolves custom → effective; reflect it immediately.
      try { setDefaults(await fetchWorktreeDefaults()) } catch { /* placeholder stays */ }
    } catch {
      // One retry over the fresh slice (another surface wrote meanwhile).
      try {
        const latest = await loadLeftRailSettings()
        viewRef.current = latest
        const view = await saveLeftRailSettings(buildNext(latest.value, dir, nest), latest.revision)
        viewRef.current = view
        setSlice(view)
        setDirDraft(view.value.worktreeDir ?? '')
        setNest(view.value.nestWorktrees ?? true)
        try { setDefaults(await fetchWorktreeDefaults()) } catch { /* placeholder stays */ }
      } catch {
        setError(t('settings.worktree.saveFailed'))
      }
    } finally {
      setSaving(false)
    }
  }

  /** Reset the directory override back to the data-root default. */
  const resetDir = (): void => {
    setDirDraft('')
  }

  return (
    <SettingsSection
      title={t('settings.worktree.title')}
      description={t('settings.worktree.description')}
    >
      <SettingsRow
        title={t('settings.worktree.dir')}
        description={custom
          ? t('settings.worktree.dirCustom')
          : (effectiveRoot !== undefined
            ? t('settings.worktree.dirDefault', { path: effectiveRoot })
            : t('settings.worktree.dirDefaultPending'))}
        disabled={saving || !loadedOnce}
        control={(
          <>
            <Input
              id="dsh-studio-worktree-dir"
              type="text"
              value={dirDraft}
              placeholder={effectiveRoot ?? t('settings.worktree.dirPlaceholder')}
              aria-label={t('settings.worktree.dir')}
              disabled={saving || !loadedOnce}
              onChange={event => { setDirDraft(event.currentTarget.value) }}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); void commit() }
                if (event.key === 'Escape') {
                  setDirDraft(slice?.value.worktreeDir ?? '')
                  event.currentTarget.blur()
                }
              }}
              onBlur={() => { void commit() }}
            />
            {custom && (
              <Button variant="ghost" size="sm" disabled={saving} onClick={resetDir}>
                {t('settings.worktree.dirReset')}
              </Button>
            )}
          </>
        )}
      />
      <SettingsRow
        title={t('settings.worktree.nest')}
        description={t('settings.worktree.nestDesc')}
        disabled={saving || !loadedOnce}
        control={(
          <Switch
            checked={nest}
            aria-label={t('settings.worktree.nest')}
            disabled={saving || !loadedOnce}
            onCheckedChange={setNest}
          />
        )}
      />
      {dirDirty && !saving && (
        <p className={css.pendingHint}>{t('settings.worktree.dirPending')}</p>
      )}
      {nestDirty && !saving && !dirDirty && (
        <p className={css.pendingHint}>{t('settings.worktree.nestPending')}</p>
      )}
      {error !== null && <FieldError>{error}</FieldError>}
    </SettingsSection>
  )
}
