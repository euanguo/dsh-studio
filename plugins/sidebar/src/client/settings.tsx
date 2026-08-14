/**
 * The "Side card" settings section contributed to the DSH Settings shell.
 * Extracted from plugin.tsx.
 */
import { useSyncExternalStore } from 'react'
import type { Translate } from '../../../shared/i18n.ts'
import type { WorkspaceMessage } from './i18n.ts'
import type {
  BoundSidebarSettingsActions,
  SidebarSettingsProps,
} from './client-types.ts'
import type { DesktopSidebarSnapshot } from './sidebar-service.ts'
import type { SidebarRuntimePreferences } from './runtime-settings.ts'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../sidebar-preferences.ts'

export function sidebarLabel(value: string | (() => string)): string {
  return typeof value === 'function' ? value() : value
}

export function SidebarSettingsRow({
  reset,
  runtime,
  setOpenByDefault,
  setTabEnabled,
  setViewerEnabled,
  setWidth,
  sidebar,
  t,
  useStore,
}: SidebarSettingsProps): JSX.Element {
  const state = useStore(snapshot => snapshot)
  const runtimeState = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
  )
  const tabs = sidebar.getTabs().filter(descriptor => descriptor.hidden !== true)
  const viewers = sidebar.getViewers()
  const updateRuntime = (
    key: keyof SidebarRuntimePreferences,
    enabled: boolean,
  ): void => {
    void runtime.update({ [key]: enabled })
  }
  return (
    <div className="oh-dsh-sidebar-settings">
      <div className="oh-dsh-sidebar-settings-heading">
        <div>
          <strong>{t('settings.title')}</strong>
          <p>{t('settings.description')}</p>
        </div>
        <button type="button" onClick={reset}>{t('settings.reset')}</button>
      </div>
      <label className="oh-dsh-sidebar-settings-row">
        <span>
          <strong>{t('settings.open-by-default')}</strong>
          <small>{t('settings.open-by-default-description')}</small>
        </span>
        <input
          type="checkbox"
          checked={state.openByDefault}
          onChange={event => { setOpenByDefault(event.currentTarget.checked) }}
        />
      </label>
      <label className="oh-dsh-sidebar-settings-size">
        <span>
          <strong>{t('settings.width')}</strong>
          <small>{t('settings.width-value', { width: state.width })}</small>
        </span>
        <input
          type="range"
          min={SIDEBAR_MIN_WIDTH}
          max={SIDEBAR_MAX_WIDTH}
          step="10"
          value={state.width}
          onChange={event => { setWidth(Number(event.currentTarget.value)) }}
        />
      </label>
      <section>
        <h4>{t('settings.runtime')}</h4>
        <p>{t('settings.runtime-description')}</p>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.agent-terminal-tools')}</strong>
            <small>{t('settings.agent-terminal-tools-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.agentTerminalTools}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime('agentTerminalTools', event.currentTarget.checked)
            }}
          />
        </label>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.bottom-terminal')}</strong>
            <small>{t('settings.bottom-terminal-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.bottomPanelAutoTerminal}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime(
                'bottomPanelAutoTerminal',
                event.currentTarget.checked,
              )
            }}
          />
        </label>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.open-files')}</strong>
            <small>{t('settings.open-files-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.interceptOpenPath}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime('interceptOpenPath', event.currentTarget.checked)
            }}
          />
        </label>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.open-links')}</strong>
            <small>{t('settings.open-links-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.browserInterceptLinks}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime(
                'browserInterceptLinks',
                event.currentTarget.checked,
              )
            }}
          />
        </label>
        {runtimeState.error !== null && (
          <p className="oh-dsh-sidebar-settings-error" role="alert">
            {t(runtimeState.error === 'load'
              ? 'settings.runtime-load-failed'
              : 'settings.runtime-save-failed')}
          </p>
        )}
      </section>
      <section>
        <h4>{t('settings.tools')}</h4>
        <p>{t('settings.tools-description')}</p>
        <div className="oh-dsh-sidebar-settings-list">
          {tabs.map(descriptor => (
            <label key={descriptor.id}>
              <span>{sidebarLabel(descriptor.title)}</span>
              <input
                type="checkbox"
                checked={state.tabsEnabled[descriptor.id] !== false}
                onChange={event => {
                  setTabEnabled(descriptor.id, event.currentTarget.checked)
                }}
              />
            </label>
          ))}
        </div>
      </section>
      <section>
        <h4>{t('settings.viewers')}</h4>
        <p>{t('settings.viewers-description')}</p>
        <div className="oh-dsh-sidebar-settings-list">
          {viewers.map(descriptor => (
            <label key={descriptor.id}>
              <span>{sidebarLabel(descriptor.title)}</span>
              <input
                type="checkbox"
                checked={state.viewersEnabled[descriptor.id] !== false}
                onChange={event => {
                  setViewerEnabled(descriptor.id, event.currentTarget.checked)
                }}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  )
}

export function syncSidebarSettings(
  actions: BoundSidebarSettingsActions | undefined,
  snapshot: DesktopSidebarSnapshot,
): void {
  actions?.sync(
    snapshot.openByDefault,
    snapshot.revision,
    { ...snapshot.tabsEnabled },
    { ...snapshot.viewersEnabled },
    snapshot.width,
  )
}
