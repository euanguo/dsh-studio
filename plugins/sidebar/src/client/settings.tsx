/**
 * The "Side card" settings section contributed to the DSH Settings shell.
 *
 * Registry-driven: every registered tab/viewer descriptor renders as a card
 * (icon + title + type id, highlighted = enabled) with an optional gear that
 * opens the feature's declarative settings — `toggles` rows bound to host
 * prefs fields, `pluginToggles` rows bound to the descriptor's own
 * `pluginSettings` blob, or a fully custom `settings.render` panel. This is
 * the settings seam external plugins declare through the contract.
 */
import { SidebarSurfaceCss as surfaceCss } from './styles.js'
import { useMemo, useState, type ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import {
  Button,
  Input,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconAdjustments } from '@dsh-studio/shared/tabler-icons'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from './i18n.ts'
import type {
  BoundSidebarSettingsActions,
  SidebarSettingsProps,
} from './client-types.ts'
import type {
  SidebarSettingToggle,
  SidebarSettingsRenderProps,
  SidebarTabDescriptor,
  SidebarViewerDescriptor,
} from './contract.ts'
import type { SidebarRuntimePreferences } from './runtime-settings.ts'
import { DEFAULT_SIDEBAR_RUNTIME_PREFERENCES } from './runtime-settings.ts'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../sidebar-preferences.ts'
import { ErrorState, SettingsRow, SettingsSection, Slider, Switch, ToolbarAction } from '@dsh-studio/shared/ui'
import { SourceControlAiSettingsPanel } from './source-control/source-control-ai-settings.tsx'
import { FeatureCard, FeatureSettingsPopup } from './settings-feature-card.tsx'
import { InputRow, renderToggleRow, sidebarLabel, SwitchRow } from './settings-rows.tsx'


/* ── the settings section ──────────────────────────────────────── */

export function SidebarSettingsRow(props: SidebarSettingsProps): JSX.Element {
  const state = props.useStore(snapshot => snapshot)
  const runtimeState = useSyncExternalStore(
    props.runtime.subscribe,
    props.runtime.getSnapshot,
  )
  const [settingsFor, setSettingsFor] = useState<
    SidebarTabDescriptor | SidebarViewerDescriptor | null
  >(null)
  const [sourceControlAiSettingsOpen, setSourceControlAiSettingsOpen] = useState(false)
  const tabs = props.sidebar.getTabs().filter(descriptor => descriptor.hidden !== true)
  const viewers = props.sidebar.getViewers()
  const updateRuntime = (
    key: keyof SidebarRuntimePreferences,
    enabled: boolean,
  ): void => {
    void props.runtime.update({ [key]: enabled })
  }
  // The host prefs face passed to custom settings panels.
  const prefs: Record<string, unknown> = useMemo(() => ({
    ...runtimeState.preferences,
    openByDefault: state.openByDefault,
    width: state.width,
  }), [runtimeState.preferences, state.openByDefault, state.width])
  const pluginSettings = settingsFor === null
    ? {}
    : state.pluginSettings[settingsFor.id] ?? {}
  const centerPreviewTabs = useSyncExternalStore(
    props.sidebar.subscribe,
    () => props.sidebar.getSnapshot().centerPreviewTabs,
  )
  const layoutScope = useSyncExternalStore(
    props.sidebar.subscribe,
    () => props.sidebar.getSnapshot().layoutScope,
  )
  const linksEnabled = runtimeState.preferences.browserInterceptLinks
  const popup = settingsFor === null ? null : (
    <FeatureSettingsPopup
      feature={settingsFor}
      prefs={prefs}
      pluginSettings={pluginSettings}
      runtime={props.runtime}
      updatePluginSetting={props.updatePluginSetting}
      onClose={() => { setSettingsFor(null) }}
      t={props.t}
    />
  )
  return (
    <SettingsSection
      className={surfaceCss["dsh-studio-sidebar-settings"]}
      title={props.t('settings.title')}
      description={props.t('settings.description')}
      actions={(
        <Button variant="outline" size="sm" onClick={props.reset}>
          {props.t('settings.reset')}
        </Button>
      )}
    >
      <SettingsSection
        title={props.t('settings.layout')}
        description={props.t('settings.layout-description')}
      >
        <div className={surfaceCss["dsh-studio-sidebar-settings-rows"]}>
          <SettingsRow
            title={props.t('settings.open-by-default')}
            description={props.t('settings.open-by-default-description')}
            control={(
              <Switch
                checked={state.openByDefault}
                aria-label={props.t('settings.open-by-default')}
                onCheckedChange={props.setOpenByDefault}
              />
            )}
          />
          <SettingsRow
            title={props.t('settings.center-preview-tabs')}
            description={props.t('settings.center-preview-tabs-description')}
            control={(
              <Switch
                checked={centerPreviewTabs === 'default'}
                aria-label={props.t('settings.center-preview-tabs')}
                onCheckedChange={checked => {
                  props.sidebar.setCenterPreviewTabs(checked ? 'default' : 'disabled')
                }}
              />
            )}
          />
          <SettingsRow
            title={props.t('settings.layout-scope')}
            description={props.t('settings.layout-scope-description')}
            control={(
              <Switch
                checked={layoutScope === 'global'}
                aria-label={props.t('settings.layout-scope')}
                onCheckedChange={checked => {
                  props.sidebar.setLayoutScope(checked ? 'global' : 'workspace')
                }}
              />
            )}
          />
          <SettingsRow
            className={surfaceCss["dsh-studio-sidebar-settings-size"]}
            title={props.t('settings.width')}
            description={props.t('settings.width-value', { width: state.width })}
            control={(
              <Slider
                min={SIDEBAR_MIN_WIDTH}
                max={SIDEBAR_MAX_WIDTH}
                step={10}
                value={state.width}
                aria-label={props.t('settings.width')}
                onValueChange={value => {
                  if (typeof value === 'number') props.setWidth(value)
                }}
              />
            )}
          />
        </div>
      </SettingsSection>
      <SettingsSection
        title={props.t('settings.behavior')}
        description={props.t('settings.behavior-description')}
      >
        <div className={surfaceCss["dsh-studio-sidebar-settings-rows"]}>
          <SwitchRow
            title={props.t('settings.open-files')}
            desc={props.t('settings.open-files-description')}
            checked={runtimeState.preferences.interceptOpenPath}
            onChange={checked => { updateRuntime('interceptOpenPath', checked) }}
          />
          <SwitchRow
            title={props.t('settings.open-links')}
            desc={props.t('settings.open-links-description')}
            checked={linksEnabled}
            onChange={checked => { updateRuntime('browserInterceptLinks', checked) }}
          />
          <SwitchRow
            title={props.t('settings.open-links-http')}
            desc={props.t('settings.open-links-http-description')}
            checked={runtimeState.preferences.browserInterceptHttp}
            disabled={!linksEnabled}
            onChange={checked => { updateRuntime('browserInterceptHttp', checked) }}
          />
          <SwitchRow
            title={props.t('settings.open-links-https')}
            desc={props.t('settings.open-links-https-description')}
            checked={runtimeState.preferences.browserInterceptHttps}
            disabled={!linksEnabled}
            onChange={checked => { updateRuntime('browserInterceptHttps', checked) }}
          />
          <SwitchRow
            title={props.t('settings.html-no-sandbox')}
            desc={props.t('settings.html-no-sandbox-description')}
            checked={runtimeState.preferences.htmlViewerNoSandbox}
            onChange={checked => { updateRuntime('htmlViewerNoSandbox', checked) }}
          />
          <SwitchRow
            title={props.t('settings.html-default-unsafe')}
            desc={props.t('settings.html-default-unsafe-description')}
            checked={runtimeState.preferences.htmlViewerDefaultUnsafe}
            onChange={checked => { updateRuntime('htmlViewerDefaultUnsafe', checked) }}
          />
          <SwitchRow
            title={props.t('settings.auto-open-subagent')}
            desc={props.t('settings.auto-open-subagent-description')}
            checked={runtimeState.preferences.autoOpenSubagent}
            onChange={checked => { updateRuntime('autoOpenSubagent', checked) }}
          />
          <SwitchRow
            title={props.t('settings.auto-open-jobs')}
            desc={props.t('settings.auto-open-jobs-description')}
            checked={runtimeState.preferences.autoOpenJobs}
            onChange={checked => { updateRuntime('autoOpenJobs', checked) }}
          />
        </div>
        {runtimeState.error !== null && (
          <ErrorState
            message={props.t(runtimeState.error === 'load'
              ? 'settings.runtime-load-failed'
              : 'settings.runtime-save-failed')}
          />
        )}
      </SettingsSection>
      <SettingsSection
        title={props.t('settings.agent-capabilities')}
        description={props.t('settings.agent-capabilities-description')}
      >
        <div className={surfaceCss["dsh-studio-sidebar-settings-rows"]}>
          <SwitchRow
            title={props.t('settings.agent-terminal-tools')}
            desc={props.t('settings.agent-terminal-tools-description')}
            checked={runtimeState.preferences.agentTerminalTools}
            onChange={checked => { updateRuntime('agentTerminalTools', checked) }}
          />
          <SwitchRow
            title={props.t('settings.agent-worktree-tools')}
            desc={props.t('settings.agent-worktree-tools-description')}
            checked={runtimeState.preferences.agentWorktreeTools}
            onChange={checked => { updateRuntime('agentWorktreeTools', checked) }}
          />
          <SwitchRow
            title={props.t('settings.agent-worktree-delegation-tools')}
            desc={props.t('settings.agent-worktree-delegation-tools-description')}
            checked={runtimeState.preferences.agentWorktreeDelegationTools}
            onChange={checked => { updateRuntime('agentWorktreeDelegationTools', checked) }}
          />
          <SettingsRow
            title={props.t('source-control-ai.title')}
            description={props.t('source-control-ai.description')}
            control={(
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSourceControlAiSettingsOpen(true) }}
              >
                {props.t('settings.feature-settings')}
              </Button>
            )}
          />
        </div>
      </SettingsSection>
      <SettingsSection
        title={props.t('settings.tools')}
        description={props.t('settings.tools-description')}
      >
        <div className={surfaceCss["dsh-studio-sidebar-settings-grid"]}>
          {tabs.map(descriptor => (
            <FeatureCard
              key={descriptor.id}
              feature={descriptor}
              enabled={state.tabsEnabled[descriptor.id] !== false}
              onToggle={enabled => { props.setTabEnabled(descriptor.id, enabled) }}
              onOpenSettings={() => { setSettingsFor(descriptor) }}
              hasSettings={descriptor.settings !== undefined}
              meta=""
              t={props.t}
            />
          ))}
        </div>
      </SettingsSection>
      <SettingsSection
        title={props.t('settings.viewers')}
        description={props.t('settings.viewers-description')}
      >
        <div className={surfaceCss["dsh-studio-sidebar-settings-grid"]}>
          {viewers.map(descriptor => (
            <FeatureCard
              key={descriptor.id}
              feature={descriptor}
              enabled={state.viewersEnabled[descriptor.id] !== false}
              onToggle={enabled => { props.setViewerEnabled(descriptor.id, enabled) }}
              onOpenSettings={() => { setSettingsFor(descriptor) }}
              hasSettings={descriptor.settings !== undefined}
              meta={descriptor.exts.length === 0 ? 'any' : descriptor.exts.join(' ')}
              t={props.t}
            />
          ))}
        </div>
      </SettingsSection>
      {popup}
      <Modal
        open={sourceControlAiSettingsOpen}
        onClose={() => { setSourceControlAiSettingsOpen(false) }}
        title={props.t('source-control-ai.title')}
        description={props.t('source-control-ai.description')}
        closeLabel={props.t('settings.done')}
        className={surfaceCss["dsh-studio-sidebar-settings-popup"]}
        contentClassName="dsh-studio-sidebar-settings-popup-content"
        footer={(
          <Button variant="primary" size="sm" onClick={() => { setSourceControlAiSettingsOpen(false) }}>
            {props.t('settings.done')}
          </Button>
        )}
      >
        <div className={surfaceCss["dsh-studio-sidebar-settings-popup-body"]}>
          <SourceControlAiSettingsPanel t={props.t} />
        </div>
      </Modal>
    </SettingsSection>
  )
}

export function syncSidebarSettings(
  actions: BoundSidebarSettingsActions | undefined,
  snapshot: {
    openByDefault: boolean
    revision: number
    tabsEnabled: Readonly<Record<string, boolean>>
    viewersEnabled: Readonly<Record<string, boolean>>
    width: number
    pluginSettings: Readonly<Record<string, Record<string, unknown>>>
  },
): void {
  actions?.sync(
    snapshot.openByDefault,
    snapshot.revision,
    { ...snapshot.tabsEnabled },
    { ...snapshot.viewersEnabled },
    snapshot.width,
    snapshot.pluginSettings,
  )
}
