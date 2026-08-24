/**
 * The "Agent capabilities" settings page: which model-facing capabilities
 * the agent may use, plus the Source Control AI entry.
 *
 * This is a sibling `settings.section` of the Side panel page
 * (order 30, before dsh-studio-sidebar at 40). Capability switches are
 * gated here so authorization reads as one page; behavior and layout stay
 * on the Side panel page. The Source Control AI form lives in this page
 * too — it is another agent-facing capability, not a panel behavior.
 */
import { SidebarSurfaceCss as surfaceCss } from './styles.js'
import { useState } from 'react'
import { useSyncExternalStore } from 'react'
import {
  Button,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from './i18n.ts'
import {
  ErrorState,
  SettingsRow,
  SettingsSection,
} from '@dsh-studio/shared/ui'
import { SwitchRow } from './settings-rows.tsx'
import type { SidebarRuntimeSettingsService } from './runtime-settings.ts'
import { SourceControlAiSettingsPanel } from './source-control/source-control-ai-settings.tsx'

/** Props of the agent-capabilities settings section. */
export interface AgentCapabilitiesSettingsSectionProps {
  /** The host-synced runtime preferences service (shared with the Side panel page). */
  runtime: SidebarRuntimeSettingsService
  /** Reset the capability switches to their defaults (all off). */
  reset(): void
  /** The section's locale seat. */
  t: Translate<WorkspaceMessage>
}

/** The switches bound to the section title in {@link settings.agent-capabilities}. */
export function AgentCapabilitiesSettingsSection(
  props: AgentCapabilitiesSettingsSectionProps,
): JSX.Element {
  const runtimeState = useSyncExternalStore(
    props.runtime.subscribe,
    props.runtime.getSnapshot,
  )
  const [sourceControlAiSettingsOpen, setSourceControlAiSettingsOpen] = useState(false)
  const updateRuntime = (
    key: 'agentTerminalTools' | 'agentWorktreeTools' | 'agentWorktreeDelegationTools',
    enabled: boolean,
  ): void => {
    void props.runtime.update({ [key]: enabled })
  }
  return (
    <SettingsSection
      className={surfaceCss["dsh-studio-sidebar-settings"]}
      title={props.t('settings.agent-capabilities')}
      description={props.t('settings.agent-capabilities-description')}
      actions={(
        <Button variant="outline" size="sm" onClick={props.reset}>
          {props.t('settings.reset')}
        </Button>
      )}
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
              disabled={runtimeState.error !== null}
              onClick={() => { setSourceControlAiSettingsOpen(true) }}
            >
              {props.t('settings.feature-settings')}
            </Button>
          )}
        />
      </div>
      {runtimeState.error !== null && (
        <ErrorState
          message={props.t(runtimeState.error === 'load'
            ? 'settings.runtime-load-failed'
            : 'settings.runtime-save-failed')}
        />
      )}
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