/**
 * Feature settings popup + registry-driven feature cards for the Side
 * card settings section (split from settings.tsx).
 */
import { useState, type ReactNode } from 'react'
import {
  Button,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import { IconAdjustments } from '@dsh-studio/shared/tabler-icons'
import { ErrorState, SettingsRow, Switch, ToolbarAction } from '@dsh-studio/shared/ui'
import { errorMessage } from '@dsh-studio/shared/errors'
import type {
  SidebarSettingsProps,
} from './client-types.ts'
import type {
  SidebarSettingsRenderProps,
  SidebarSurfaceDescriptor,
} from './contract.ts'
import {
  sidebarDescriptorSettings,
  sidebarDescriptorTitle,
} from './contract.ts'
import type { SidebarRuntimePreferences } from './runtime-settings.ts'
import { DEFAULT_SIDEBAR_RUNTIME_PREFERENCES } from './runtime-settings.ts'
import type { WorkspaceMessage } from './i18n.ts'
import { renderToggleRow } from './settings-rows.tsx'
import { SidebarSurfaceCss as surfaceCss } from './styles.js'

/** The host prefs fields \`settings.toggles\` may bind (unknown keys are
 *  dropped by the seam). */
function isRuntimePrefKey(key: string): key is keyof SidebarRuntimePreferences {
  return key in DEFAULT_SIDEBAR_RUNTIME_PREFERENCES
}

/** Resolve the user-facing label of a descriptor (rail title, then viewer
 *  display name, then the kind). */
function featureLabel(descriptor: SidebarSurfaceDescriptor): string {
  const title = sidebarDescriptorTitle(descriptor)
  return typeof title === 'function' ? title() : title
}

export function FeatureSettingsPopup(props: {
  feature: SidebarSurfaceDescriptor
  prefs: Record<string, unknown>
  pluginSettings: Record<string, unknown>
  runtime: SidebarSettingsProps['runtime']
  updatePluginSetting(id: string, key: string, value: unknown): void
  onClose(): void
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const { feature, prefs, pluginSettings, runtime, updatePluginSetting, onClose, t } = props
  const declaration = sidebarDescriptorSettings(feature)
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
          updatePluginSetting(feature.kind, key, value)
        },
        close: onClose,
      } satisfies SidebarSettingsRenderProps)
    } catch (error) {
      body = <ErrorState message={errorMessage(error)} />
    }
  } else {
    body = (
      <>
        {hostToggles.length > 0 && (
          <>
            <h4 className={surfaceCss["dsh-studio-sidebar-settings-popup-heading"]}>
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
            <h4 className={surfaceCss["dsh-studio-sidebar-settings-popup-heading"]}>
              {t('settings.plugin-settings')}
            </h4>
            {pluginToggles.map(toggle => (
              <div key={toggle.key}>
                {renderToggleRow({
                  toggle,
                  value: pluginSettings[toggle.key],
                  onCommit: value => {
                    updatePluginSetting(feature.kind, toggle.key, value)
                  },
                })}
              </div>
            ))}
          </>
        )}
        {hostToggles.length === 0 && pluginToggles.length === 0 && (
          <p className={surfaceCss["dsh-studio-sidebar-settings-popup-empty"]}>{t('settings.no-feature-settings')}</p>
        )}
      </>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={featureLabel(feature)}
      description={feature.kind}
      closeLabel={t('settings.done')}
      className={surfaceCss["dsh-studio-sidebar-settings-popup"]}
      contentClassName="dsh-studio-sidebar-settings-popup-content"
      footer={(
        <Button variant="primary" size="sm" onClick={onClose}>
          {t('settings.done')}
        </Button>
      )}
    >
      <div className={surfaceCss["dsh-studio-sidebar-settings-popup-body"]}>{body}</div>
    </Modal>
  )
}

/* ── registry-driven feature cards ─────────────────────────────── */

export function FeatureCard(props: {
  feature: SidebarSurfaceDescriptor
  enabled: boolean
  onToggle(enabled: boolean): void
  onOpenSettings(): void
  hasSettings: boolean
  meta: string
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const { feature, enabled, onToggle, onOpenSettings, hasSettings, meta, t } = props
  const id = feature.kind
  const label = featureLabel(feature)
  const description = meta === '' ? undefined : meta
  return (
    <SettingsRow
      data-feature-id={id}
      title={label}
      {...(description === undefined ? {} : { description })}
      control={(
        <span className={surfaceCss["dsh-studio-sidebar-settings-controls"]}>
          {hasSettings && enabled && (
            <ToolbarAction
              className={surfaceCss["dsh-studio-sidebar-feature-gear"]}
              icon={<IconAdjustments size={16} />}
              label={t('settings.feature-settings')}
              onClick={() => { onOpenSettings() }}
            />
          )}
          <Switch
            checked={enabled}
            aria-label={featureLabel(feature)}
            onCheckedChange={onToggle}
          />
        </span>
      )}
    />
  )
}