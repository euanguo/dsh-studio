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
import type { Translate } from '../../../shared/i18n.ts'
import type { WorkspaceMessage } from './i18n.ts'
import { Scrollable } from '../../../shared/scrollable.tsx'
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
import { ErrorView } from './kit/status.tsx'

export function sidebarLabel(value: string | (() => string)): string {
  return typeof value === 'function' ? value() : value
}

/** Resolve a descriptor icon (ReactNode or size function). */
function descriptorIcon(
  icon: ReactNode | ((size: number) => ReactNode) | undefined,
  size: number,
): ReactNode {
  if (icon === undefined) return null
  return typeof icon === 'function' ? icon(size) : icon
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
    <label className="oh-dsh-sidebar-settings-row">
      <span>
        <strong>{props.title}</strong>
        {props.desc !== undefined && <small>{props.desc}</small>}
      </span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={event => { props.onChange(event.currentTarget.checked) }}
      />
    </label>
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
    <label className="oh-dsh-sidebar-settings-row">
      <span>
        <strong>{props.title}</strong>
        {props.desc !== undefined && <small>{props.desc}</small>}
      </span>
      <span className="oh-dsh-sidebar-settings-input">
        <input
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
        {props.unit !== undefined && <span className="oh-dsh-sidebar-settings-unit">{props.unit}</span>}
      </span>
    </label>
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
      body = <ErrorView message={error instanceof Error ? error.message : String(error)} />
    }
  } else {
    body = (
      <>
        {hostToggles.length > 0 && (
          <>
            <h4 className="oh-dsh-sidebar-settings-popup-heading">
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
            <h4 className="oh-dsh-sidebar-settings-popup-heading">
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
          <p className="oh-dsh-sidebar-settings-popup-empty">{t('settings.no-feature-settings')}</p>
        )}
      </>
    )
  }

  return (
    <div
      className="oh-dsh-sidebar-settings-popup"
      role="dialog"
      aria-label={sidebarLabel(feature.title ?? feature.id)}
      onClick={event => { event.stopPropagation() }}
    >
      <div className="oh-dsh-sidebar-settings-popup-head">
        <strong>{sidebarLabel(feature.title ?? feature.id)}</strong>
        <code>{feature.id}</code>
      </div>
      <Scrollable className="oh-dsh-sidebar-settings-popup-body">{body}</Scrollable>
      <div className="oh-dsh-sidebar-settings-popup-foot">
        <button type="button" onClick={onClose}>{t('settings.done')}</button>
      </div>
    </div>
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
  return (
    <div
      className={`oh-dsh-sidebar-feature-card${enabled ? ' is-enabled' : ''}`}
      data-feature-id={id}
      role="checkbox"
      aria-checked={enabled}
      tabIndex={0}
      onClick={() => { onToggle(!enabled) }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle(!enabled)
        }
      }}
    >
      <span className="oh-dsh-sidebar-feature-icon" aria-hidden="true">
        {descriptorIcon(feature.icon, 18)}
      </span>
      <span className="oh-dsh-sidebar-feature-main">
        <strong>{sidebarLabel(feature.title ?? id)}</strong>
        <code>{id}{meta === '' ? '' : ` · ${meta}`}</code>
      </span>
      {enabled && (
        <span className="oh-dsh-sidebar-feature-check" aria-hidden="true">✓</span>
      )}
      {hasSettings && enabled && (
        <button
          type="button"
          className="oh-dsh-sidebar-feature-gear"
          aria-label={t('settings.feature-settings')}
          title={t('settings.feature-settings')}
          onClick={event => {
            event.stopPropagation()
            onOpenSettings()
          }}
        >⚙</button>
      )}
    </div>
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
  const popup = settingsFor === null ? null : (
    <div
      className="oh-dsh-sidebar-settings-popup-backdrop"
      onClick={() => { setSettingsFor(null) }}
    >
      <FeatureSettingsPopup
        feature={settingsFor}
        prefs={prefs}
        pluginSettings={pluginSettings}
        runtime={props.runtime}
        updatePluginSetting={props.updatePluginSetting}
        onClose={() => { setSettingsFor(null) }}
        t={props.t}
      />
    </div>
  )
  return (
    <div className="oh-dsh-sidebar-settings">
      <div className="oh-dsh-sidebar-settings-heading">
        <div>
          <strong>{props.t('settings.title')}</strong>
          <p>{props.t('settings.description')}</p>
        </div>
        <button type="button" onClick={props.reset}>{props.t('settings.reset')}</button>
      </div>
      <label className="oh-dsh-sidebar-settings-row">
        <span>
          <strong>{props.t('settings.open-by-default')}</strong>
          <small>{props.t('settings.open-by-default-description')}</small>
        </span>
        <input
          type="checkbox"
          checked={state.openByDefault}
          onChange={event => { props.setOpenByDefault(event.currentTarget.checked) }}
        />
      </label>
      <label className="oh-dsh-sidebar-settings-size">
        <span>
          <strong>{props.t('settings.width')}</strong>
          <small>{props.t('settings.width-value', { width: state.width })}</small>
        </span>
        <input
          type="range"
          min={SIDEBAR_MIN_WIDTH}
          max={SIDEBAR_MAX_WIDTH}
          step="10"
          value={state.width}
          onChange={event => { props.setWidth(Number(event.currentTarget.value)) }}
        />
      </label>
      <section>
        <h4>{props.t('settings.runtime')}</h4>
        <p>{props.t('settings.runtime-description')}</p>
        <SwitchRow
          title={props.t('settings.agent-terminal-tools')}
          desc={props.t('settings.agent-terminal-tools-description')}
          checked={runtimeState.preferences.agentTerminalTools}
          onChange={checked => { updateRuntime('agentTerminalTools', checked) }}
        />
        <SwitchRow
          title={props.t('settings.bottom-terminal')}
          desc={props.t('settings.bottom-terminal-description')}
          checked={runtimeState.preferences.bottomPanelAutoTerminal}
          onChange={checked => { updateRuntime('bottomPanelAutoTerminal', checked) }}
        />
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
        {runtimeState.error !== null && (
          <ErrorView
            message={props.t(runtimeState.error === 'load'
              ? 'settings.runtime-load-failed'
              : 'settings.runtime-save-failed')}
          />
        )}
      </section>
      <section>
        <h4>{props.t('settings.tools')}</h4>
        <p>{props.t('settings.tools-description')}</p>
        <div className="oh-dsh-sidebar-feature-grid">
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
      </section>
      <section>
        <h4>{props.t('settings.viewers')}</h4>
        <p>{props.t('settings.viewers-description')}</p>
        <div className="oh-dsh-sidebar-feature-grid">
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
      </section>
      {popup}
    </div>
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
