/**
 * The built-in right-rail surface declarations (review / terminal / files /
 * file / side-chat / trajectory / subagent), contributed through the same
 * {@linkcode DesktopSidebarService.register} face external plugins use. The
 * terminal and file kinds also carry a center-workbench renderer; those
 * aspects are declared in `./surfaces.tsx` and unified per kind by
 * `./index.ts`. side-chat / trajectory are action-only shortcuts that run an
 * action instead of opening a tab.
 */
import {
  formatKeymapHint,
  binding,
} from '../kit/keymap.ts'
import { ToolIcon } from '../SideToolsPanel.tsx'
import { FilesView, FileView } from '../files/files-view.tsx'
import { WorkspacePanel } from '../workspace-panel.tsx'
import { SubagentPanel } from '../subagent/subagent-panel.tsx'
import { TerminalTabContent } from '../terminal-tab.tsx'
import type { SidebarSurfaceDescriptor } from '../contract.ts'
import type { SidebarBuiltinDeps } from './deps.ts'
import { sidebarApi } from '../sidebar-api.ts'
import {
  canOpenTerminalInstance,
  releaseTerminalInstance,
  touchTerminalInstance,
} from '../runtimes/terminal-runtime.ts'

/** A rail-aspect declaration awaiting kind-level unification. */
export type RailPart = Pick<SidebarSurfaceDescriptor, 'kind' | 'rail' | 'scopeNeed' | 'previewable' | 'focusPolicy'>

/** The built-in rail declarations (ascending + menu order). */
export function builtinTabs(deps: SidebarBuiltinDeps): readonly RailPart[] {
  const { t } = deps
  return [
    {
      kind: 'review',
      rail: {
        chrome: 'custom',
        icon: <ToolIcon kind="review" />,
        order: 10,
        render: () => (
          <WorkspacePanel
            reviewComments={deps.reviewComments}
            sessions={deps.sessions}
            sidebar={deps.sidebar}
            t={t}
          />
        ),
        shortcut: formatKeymapHint(binding({ ctrl: true, shift: true, key: 'g' })),
        single: true,
        title: () => t('review'),
      },
      scopeNeed: 'workspace',
      previewable: false,
      focusPolicy: 'never',
    },
    {
      kind: 'terminal',
      rail: {
        // First-class terminal: one independent shell per tab, whether the
        // tab is opened in the rail or the center workbench.
        icon: <ToolIcon kind="terminal" />,
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
      scopeNeed: null,
      previewable: false,
      focusPolicy: 'never',
    },
    {
      kind: 'files',
      rail: {
        dedupeKey: tab => tab.resource,
        icon: <ToolIcon kind="files" />,
        render: props => (
          <FilesView
            {...props}
            sidebar={deps.sidebar}
            t={t}
          />
        ),
        shortcut: formatKeymapHint(binding({ mod: true, key: 'p' })),
        title: () => t('files'),
      },
      scopeNeed: 'workspace',
      previewable: false,
      focusPolicy: 'never',
    },
    {
      kind: 'file',
      rail: {
        dedupeKey: tab => tab.resource,
        hidden: true,
        icon: <ToolIcon kind="file" />,
        render: props => (
          <FileView
            {...props}
            onOpenPath={deps.openExternalPath}
            reviewComments={deps.reviewComments}
            sidebar={deps.sidebar}
            t={t}
          />
        ),
        title: () => t('files'),
      },
      scopeNeed: 'workspace',
      previewable: false,
      focusPolicy: 'never',
    },
    {
      kind: 'side-chat',
      rail: {
        action: async () => { await deps.service.openSideChat() },
        hidden: true,
        icon: <ToolIcon kind="chat" />,
        order: 50,
        shortcut: formatKeymapHint(binding({ mod: true, alt: true, key: 's' })),
        title: () => t('side-chat'),
      },
      scopeNeed: null,
      previewable: false,
      focusPolicy: 'never',
    },
    {
      kind: 'trajectory',
      rail: {
        action: () => { deps.service.openTrajectory() },
        hidden: true,
        icon: <ToolIcon kind="trajectory" />,
        order: 60,
        title: () => t('trajectory'),
      },
      scopeNeed: 'workspace',
      previewable: false,
      focusPolicy: 'never',
    },
    {
      kind: 'subagent',
      rail: {
        icon: <ToolIcon kind="subagent" />,
        order: 30,
        render: () => (
          <SubagentPanel
            sidebar={deps.sidebar}
            sessions={deps.sessions}
            runtime={deps.runtimeSettings}
            t={t}
          />
        ),
        single: true,
        // The auto-open switches ride the top-level "Opening behavior"
        // section; the subagent tab keeps no detail rows.
        title: () => t('subagent'),
      },
      scopeNeed: null,
      previewable: false,
      focusPolicy: 'never',
    },
  ]
}
