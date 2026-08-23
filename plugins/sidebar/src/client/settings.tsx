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

export function sidebarLabel(value: string | (() => string)): string {
  return typeof value === 'function' ? value() : value
}

/** The host prefs fields `settings.toggles` may bind (unknown keys are
 *  dropped by the seam). */
function isRuntimePrefKey(key: string): key is keyof SidebarRuntimePreferences {
  return key in DEFAULT_SIDEBAR_RUNTIME_PREFERENCES
}

function clampNumber(value: number, min?: number, max?: number): number {
  let next = value
  if (min !== undefined && next < min) next = min
  if (max !== undefined && next > max) next = max
  return next
}

/* ── declarative setting rows ──────────────────────────────────── */

function SwitchRow(props: {
  title: string
  desc?: string
  checked: boolean
  onChange(checked: boolean): void
}): JSX.Element {
  return (
    <SettingsRow
      title={props.title}
      {...(props.desc === undefined ? {} : { description: props.desc })}
      control={(
        <Switch
          checked={props.checked}
          aria-label={props.desc ?? props.title}
          onCheckedChange={props.onChange}
        />
      )}
    />
  )
}

function InputRow(props: {
  title: string
  desc?: string
  type: 'text' | 'number'
  value: unknown
  min?: number
  max?: number
  placeholder?: string
  unit?: string
  onCommit(value: string | number): void
}): JSX.Element {
  const [draft, setDraft] = useState<string>(
    props.value === undefined ? '' : String(props.value),
  )
  const commit = (): void => {
    const value = props.type === 'number'
      ? clampNumber(Number(draft), props.min, props.max)
      : draft
    if (props.type === 'number' && !Number.isFinite(value)) return
    setDraft(String(value))
    props.onCommit(value)
  }
  return (
    <SettingsRow
      title={props.title}
      {...(props.desc === undefined ? {} : { description: props.desc })}
      control={(
        <span className="dsh-studio-sidebar-settings-input">
          <Input
            type={props.type}
            value={draft}
            min={props.min}
            max={props.max}
            placeholder={props.placeholder}
            onChange={event => { setDraft(event.currentTarget.value) }}
            onBlur={commit}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                ;(event.target as HTMLInputElement).blur()
              }
              if (event.key === 'Escape') {
                setDraft(props.value === undefined ? '' : String(props.value))
                ;(event.target as HTMLInputElement).blur()
              }
            }}
          />
          {props.unit !== undefined && <span className="dsh-studio-sidebar-settings-unit">{props.unit}</span>}
        </span>
      )}
    />
  )
}

function renderToggleRow(props: {
  toggle: SidebarSettingToggle
  value: unknown
  onCommit(value: string | number | boolean): void
}): JSX.Element {
  const { toggle, value, onCommit } = props
  const title = sidebarLabel(toggle.title)
  const desc = toggle.desc === undefined ? undefined : sidebarLabel(toggle.desc)
  if (toggle.type === 'text' || toggle.type === 'number') {
    return (
      <InputRow
        title={title}
        {...(desc === undefined ? {} : { desc })}
        type={toggle.type}
        value={value}
        {...(toggle.min === undefined ? {} : { min: toggle.min })}
        {...(toggle.max === undefined ? {} : { max: toggle.max })}
        {...(toggle.placeholder === undefined ? {} : { placeholder: toggle.placeholder })}
        {...(toggle.unit === undefined ? {} : { unit: toggle.unit })}
        onCommit={next => { onCommit(next) }}
      />
    )
  }
  return (
    <SwitchRow
      title={title}
      {...(desc === undefined ? {} : { desc })}
      checked={value === true}
      onChange={checked => { onCommit(checked) }}
    />
  )
}

/* ── the feature settings popup ────────────────────────────────── */

function FeatureSettingsPopup(props: {
  feature: SidebarTabDescriptor | SidebarViewerDescriptor
  prefs: Record<string, unknown>
  pluginSettings: Record<string, unknown>
  runtime: SidebarSettingsProps['runtime']
  updatePluginSetting(id: string, key: string, value: unknown): void
  onClose(): void
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const { feature, prefs, pluginSettings, runtime, updatePluginSetting, onClose, t } = props
  const declaration = feature.settings
  const hasRender = declaration?.render !== undefined
  const hostToggles = (declaration?.toggles ?? []).filter(toggle =>
    isRuntimePrefKey(toggle.key))
  const pluginToggles = declaration?.pluginToggles ?? []

  let body: ReactNode
  if (hasRender) {
    // A custom panel replaces the row lists entirely (a throw is swallowed
    // and shown inline so one broken plugin never breaks the popup).
    try {
      body = declaration!.render!({
        prefs,
        pluginSettings,
        updatePluginSetting: (key, value) => {
          updatePluginSetting(feature.id, key, value)
        },
        close: onClose,
      } satisfies SidebarSettingsRenderProps)
    } catch (error) {
      body = <ErrorState message={error instanceof Error ? error.message : String(error)} />
    }
  } else {
    body = (
      <>
        {hostToggles.length > 0 && (
          <>
            <h4 className="dsh-studio-sidebar-settings-popup-heading">
              {t('settings.feature-settings')}
            </h4>
            {hostToggles.map(toggle => (
              <div key={toggle.key}>
                {renderToggleRow({
                  toggle,
                  value: prefs[toggle.key],
                  onCommit: value => {
                    void runtime.update({ [toggle.key]: value } as Partial<SidebarRuntimePreferences>)
                  },
                })}
              </div>
            ))}
          </>
        )}
        {pluginToggles.length > 0 && (
          <>
            <h4 className="dsh-studio-sidebar-settings-popup-heading">
              {t('settings.plugin-settings')}
            </h4>
            {pluginToggles.map(toggle => (
              <div key={toggle.key}>
                {renderToggleRow({
                  toggle,
                  value: pluginSettings[toggle.key],
                  onCommit: value => {
                    updatePluginSetting(feature.id, toggle.key, value)
                  },
                })}
              </div>
            ))}
          </>
        )}
        {hostToggles.length === 0 && pluginToggles.length === 0 && (
          <p className="dsh-studio-sidebar-settings-popup-empty">{t('settings.no-feature-settings')}</p>
        )}
      </>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={sidebarLabel(feature.title ?? feature.id)}
      description={feature.id}
      closeLabel={t('settings.done')}
      className="dsh-studio-sidebar-settings-popup"
      contentClassName="dsh-studio-sidebar-settings-popup-content"
      footer={(
        <Button variant="primary" size="sm" onClick={onClose}>
          {t('settings.done')}
        </Button>
      )}
    >
      <div className="dsh-studio-sidebar-settings-popup-body">{body}</div>
    </Modal>
  )
}

/* ── registry-driven feature cards ─────────────────────────────── */

function FeatureCard(props: {
  feature: SidebarTabDescriptor | SidebarViewerDescriptor
  enabled: boolean
  onToggle(enabled: boolean): void
  onOpenSettings(): void
  hasSettings: boolean
  meta: string
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const { feature, enabled, onToggle, onOpenSettings, hasSettings, meta, t } = props
  const id = feature.id
  const label = sidebarLabel(feature.title ?? id)
  const description = meta === '' ? undefined : meta
  return (
    <SettingsRow
      data-feature-id={id}
      title={label}
      {...(description === undefined ? {} : { description })}
      control={(
        <span className="dsh-studio-sidebar-settings-controls">
          {hasSettings && enabled && (
            <ToolbarAction
              className="dsh-studio-sidebar-feature-gear"
              icon={<IconAdjustments size={16} />}
              label={t('settings.feature-settings')}
              onClick={() => { onOpenSettings() }}
            />
          )}
          <Switch
            checked={enabled}
            aria-label={sidebarLabel(feature.title ?? id)}
            onCheckedChange={onToggle}
          />
        </span>
      )}
    />
  )
}

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
      className="dsh-studio-sidebar-settings"
      title={props.t('settings.title')}
      description={props.t('settings.description')}
      actions={(
        <Button variant="outline" size="sm" onClick={props.reset}>
          {props.t('settings.reset')}
        </Button>
      )}
    >
      <div className="dsh-studio-sidebar-settings-rows">
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
          className="dsh-studio-sidebar-settings-size"
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
      <SettingsSection
        title={props.t('settings.runtime')}
        description={props.t('settings.runtime-description')}
      >
        <div className="dsh-studio-sidebar-settings-rows">
        <SwitchRow
          title={props.t('settings.agent-terminal-tools')}
          desc={props.t('settings.agent-terminal-tools-description')}
          checked={runtimeState.preferences.agentTerminalTools}
          onChange={checked => { updateRuntime('agentTerminalTools', checked) }}
        />
        {/* CUT (user preference): the bottom-mounted terminal dock no longer
            exists, so its auto-open switch has no target. Restore with the
            dock (plugins/panel-controls).
        <SwitchRow
          title={props.t('settings.bottom-terminal')}
          desc={props.t('settings.bottom-terminal-description')}
          checked={runtimeState.preferences.bottomPanelAutoTerminal}
          onChange={checked => { updateRuntime('bottomPanelAutoTerminal', checked) }}
        />
        */}
        <SwitchRow
          title={props.t('settings.open-files')}
          desc={props.t('settings.open-files-description')}
          checked={runtimeState.preferences.interceptOpenPath}
          onChange={checked => { updateRuntime('interceptOpenPath', checked) }}
        />
        <SwitchRow
          title={props.t('settings.open-links')}
          desc={props.t('settings.open-links-description')}
          checked={runtimeState.preferences.browserInterceptLinks}
          onChange={checked => { updateRuntime('browserInterceptLinks', checked) }}
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
      <section>
        <div className="dsh-studio-sidebar-settings-rows">
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
      </section>
      <SettingsSection
        title={props.t('settings.tools')}
        description={props.t('settings.tools-description')}
      >
        <div className="dsh-studio-sidebar-settings-grid">
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
        <div className="dsh-studio-sidebar-settings-grid">
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
        className="dsh-studio-sidebar-settings-popup"
        contentClassName="dsh-studio-sidebar-settings-popup-content"
        footer={(
          <Button variant="primary" size="sm" onClick={() => { setSourceControlAiSettingsOpen(false) }}>
            {props.t('settings.done')}
          </Button>
        )}
      >
        <div className="dsh-studio-sidebar-settings-popup-body">
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
