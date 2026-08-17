/**
 * The built-in sidebar tab descriptors (review / files / file / terminal /
 * side-chat / trajectory), registered through the same
 * {@link DesktopSidebarService} external plugins use — eating our own
 * dogfood. Action-only descriptors (terminal / side-chat / trajectory) are
 * menu shortcuts: opening them runs the action instead of opening a tab.
 */
import {
  formatKeymapHint,
  binding,
} from '../kit/keymap.ts'
import {
  ToolIcon,
  FilesView,
  FileView,
} from '../SideToolsPanel.tsx'
import { WorkspacePanel } from '../workspace-panel.tsx'
import { SubagentPanel } from '../subagent/subagent-panel.tsx'
import type { SidebarTabDescriptor } from '../contract.ts'
import type { SidebarBuiltinDeps } from './deps.ts'

/** The built-in tab descriptors (ascending + menu order). */
export function builtinTabs(deps: SidebarBuiltinDeps): readonly SidebarTabDescriptor[] {
  const { t } = deps
  return [
    {
      chrome: 'custom',
      icon: <ToolIcon kind="review" />,
      id: 'review',
      order: 10,
      render: () => (
        <WorkspacePanel
          reviewComments={deps.reviewComments}
          service={deps.service}
          sessions={deps.sessions}
          workspaces={deps.workspaces}
          t={t}
        />
      ),
      requiresWorkspace: true,
      shortcut: formatKeymapHint(binding({ ctrl: true, shift: true, key: 'g' })),
      single: true,
      title: () => t('review'),
    },
    {
      action: () => { deps.panels.toggleBottomPanel() },
      icon: <ToolIcon kind="terminal" />,
      id: 'terminal',
      order: 20,
      shortcut: formatKeymapHint(binding({ mod: true, key: 'j' })),
      // Declarative settings: the model-facing tools switch and the
      // bottom-panel auto-terminal switch render under this tab's card in
      // the settings page (the host gates the toolset on the first one).
      settings: {
        toggles: [{
          key: 'agentTerminalTools',
          title: () => t('settings.agent-terminal-tools'),
          desc: () => t('settings.agent-terminal-tools-description'),
        }, {
          key: 'bottomPanelAutoTerminal',
          title: () => t('settings.bottom-terminal'),
          desc: () => t('settings.bottom-terminal-description'),
        }, {
          key: 'terminalFontFamily',
          title: () => t('settings.terminal-font-family'),
          desc: () => t('settings.terminal-font-family-description'),
          type: 'text',
          placeholder: t('settings.terminal-font-family-placeholder'),
        }, {
          key: 'terminalFontSize',
          title: () => t('settings.terminal-font-size'),
          desc: () => t('settings.terminal-font-size-description'),
          type: 'number',
          min: 9,
          max: 32,
          unit: 'px',
        }, {
          key: 'terminalShell',
          title: () => t('settings.terminal-shell'),
          desc: () => t('settings.terminal-shell-description'),
          type: 'text',
          placeholder: t('settings.terminal-shell-placeholder'),
        }],
      },
      title: () => t('terminal'),
    },
    {
      dedupeKey: tab => tab.resource,
      icon: <ToolIcon kind="files" />,
      id: 'files',
      order: 40,
      render: props => (
        <FilesView
          {...props}
          sidebar={deps.sidebar}
          t={t}
        />
      ),
      requiresWorkspace: true,
      shortcut: formatKeymapHint(binding({ mod: true, key: 'p' })),
      title: () => t('files'),
    },
    {
      dedupeKey: tab => tab.resource,
      hidden: true,
      icon: <ToolIcon kind="file" />,
      id: 'file',
      render: props => (
        <FileView
          {...props}
          onOpenPath={deps.openExternalPath}
          reviewComments={deps.reviewComments}
          sidebar={deps.sidebar}
          t={t}
        />
      ),
      requiresWorkspace: true,
      title: () => t('files'),
    },
    {
      action: async () => { await deps.service.openSideChat() },
      icon: <ToolIcon kind="chat" />,
      id: 'side-chat',
      order: 50,
      shortcut: formatKeymapHint(binding({ mod: true, alt: true, key: 's' })),
      title: () => t('side-chat'),
    },
    {
      action: () => { deps.service.openTrajectory() },
      icon: <ToolIcon kind="trajectory" />,
      id: 'trajectory',
      order: 60,
      requiresWorkspace: true,
      title: () => t('trajectory'),
    },
    {
      icon: <ToolIcon kind="subagent" />,
      id: 'subagent',
      order: 30,
      single: true,
      render: () => (
        <SubagentPanel
          sidebar={deps.sidebar}
          sessions={deps.sessions}
          runtime={deps.runtimeSettings}
          t={t}
        />
      ),
      // Declarative settings: the auto-open toggles render under this tab's
      // card in the settings page (opening the sidebar on new subagents /
      // new background jobs).
      settings: {
        toggles: [{
          key: 'autoOpenSubagent',
          title: () => t('settings.auto-open-subagent'),
          desc: () => t('settings.auto-open-subagent-description'),
        }, {
          key: 'autoOpenJobs',
          title: () => t('settings.auto-open-jobs'),
          desc: () => t('settings.auto-open-jobs-description'),
        }],
      },
      title: () => t('subagent'),
    },
  ]
}
