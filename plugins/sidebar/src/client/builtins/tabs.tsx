/**
 * The built-in sidebar tab descriptors (review / terminal / files / file /
 * side-chat / trajectory), registered through the same
 * {@link DesktopSidebarService} external plugins use. The terminal descriptor
 * renders a first-class xterm tab; side-chat / trajectory are action-only menu
 * shortcuts that run an action instead of opening a tab.
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
import { TerminalTabContent } from '../terminal-tab.tsx'
import type { SidebarTabDescriptor } from '../contract.ts'
import type { SidebarBuiltinDeps } from './deps.ts'
import { sidebarApi } from '../sidebar-api.ts'
import {
  canOpenTerminalInstance,
  releaseTerminalInstance,
  touchTerminalInstance,
} from '../runtimes/terminal-runtime.ts'

/** The built-in sidebar tab descriptors (ascending + menu order). */
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
          t={t}
        />
      ),
      requiresWorkspace: true,
      shortcut: formatKeymapHint(binding({ ctrl: true, shift: true, key: 'g' })),
      single: true,
      title: () => t('review'),
    },
    {
      // First-class terminal: one independent shell per tab, whether the tab
      // is opened in the rail or the center workbench.
      icon: <ToolIcon kind="terminal" />,
      id: 'terminal',
      order: 20,
      available: scope => scope === null || scope.cwd === undefined
        ? true
        : canOpenTerminalInstance(scope),
      render: props => (
        <TerminalTabContent
          cwd={props.scope?.cwd ?? null}
          tabId={props.tab.id}
           onTitleChange={title => { deps.sidebar.updateTab(props.tab.id, { title }) }}
           onLink={uri => { window.open(uri, '_blank', 'noopener,noreferrer') }}
          runtime={deps.runtimeSettings}
          t={t}
        />
      ),
      onClose: (tab, scope) => {
        releaseTerminalInstance(scope, tab.id)
        void sidebarApi.ptyClose(scope, tab.id)
      },
      onOpen: (tab, scope) => {
        if (scope.cwd !== undefined) touchTerminalInstance(scope, tab.id)
      },
      shortcut: formatKeymapHint(binding({ mod: true, key: 'j' })),
      settings: {
        toggles: [{
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
        }, {
          key: 'terminalScrollbackRows',
          title: () => t('settings.terminal-scrollback-rows'),
          desc: () => t('settings.terminal-scrollback-rows-description'),
          type: 'number',
          min: 1000,
          max: 50000,
          unit: 'rows',
        }, {
          key: 'terminalReconnectGraceMs',
          title: () => t('settings.terminal-reconnect-grace-ms'),
          desc: () => t('settings.terminal-reconnect-grace-ms-description'),
          type: 'number',
          min: 0,
          max: 120000,
          unit: 'ms',
        }, {
          key: 'terminalProcessKillGraceMs',
          title: () => t('settings.terminal-process-kill-grace-ms'),
          desc: () => t('settings.terminal-process-kill-grace-ms-description'),
          type: 'number',
          min: 250,
          max: 10000,
          unit: 'ms',
        }, {
          key: 'terminalRetainedInactiveSessions',
          title: () => t('settings.terminal-retained-inactive-sessions'),
          desc: () => t('settings.terminal-retained-inactive-sessions-description'),
          type: 'number',
          min: 0,
          max: 1024,
          unit: 'sessions',
        }, {
          key: 'terminalMouseWheelMultiplier',
          title: () => t('settings.terminal-mouse-wheel-multiplier'),
          desc: () => t('settings.terminal-mouse-wheel-multiplier-description'),
          type: 'number',
          min: 0.25,
          max: 4,
          unit: 'x',
        }, {
          key: 'terminalGpuAcceleration',
          title: () => t('settings.terminal-gpu-acceleration'),
          desc: () => t('settings.terminal-gpu-acceleration-description'),
          type: 'text',
          placeholder: t('settings.terminal-gpu-acceleration-placeholder'),
        }],
      },
      title: () => t('terminal'),
    },
    {
      dedupeKey: tab => tab.resource,
      icon: <ToolIcon kind="files" />,
      id: 'files',
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
      hidden: true,
      icon: <ToolIcon kind="chat" />,
      id: 'side-chat',
      order: 50,
      shortcut: formatKeymapHint(binding({ mod: true, alt: true, key: 's' })),
      title: () => t('side-chat'),
    },
    {
      action: () => { deps.service.openTrajectory() },
      hidden: true,
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
