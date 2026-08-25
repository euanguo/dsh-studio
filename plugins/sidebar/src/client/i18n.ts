import type { LocaleMessages } from '@dsh-studio/shared/i18n'

export type WorkspaceMessage =
  | 'side.expand'
  | 'side.restore'
  | 'summary.title'
  | 'terminal.toggle'
  | 'terminal.title'
  | 'terminal.process-exited'
  | 'terminal.unknown'
  | 'terminal.error'
  | 'add.open'
  | 'add.new-conversation'
  | 'side.toggle'
  | 'side.title'
  | 'review'
  | 'terminal'
  | 'browser'
  | 'files'
  | 'side-chat'
  | 'trajectory'
  | 'subagent'
  | 'subagent.topology'
  | 'subagent.jobs'
  | 'subagent.no-topology'
  | 'subagent.no-jobs'
  | 'subagent.main-session'
  | 'subagent.current'
  | 'subagent.refresh'
  | 'subagent.output'
  | 'subagent.kill'
  | 'subagent.job-output-empty'
  | 'subagent.job-output-failed'
  | 'browser.enter-url'
  | 'browser.http-only'
  | 'browser.page-failed'
  | 'browser.back'
  | 'browser.reload'
  | 'browser.url'
  | 'files.select-workspace'
  | 'files.loading'
  | 'files.empty-directory'
  | 'files.open'
  | 'files.preview-truncated'
  | 'files.not-file'
  | 'files.no-viewer'
  | 'files.empty-file'
  | 'files.empty-notebook'
  | 'files.file-path'
  | 'files.table-of-contents'
  | 'files.search-no-matches'
  | 'files.search-unavailable'
  | 'files.image-loading'
  | 'files.image-load-failed'
  | 'files.zoom-out'
  | 'files.zoom-in'
  | 'files.zoom-reset'
  | 'files.open-externally'
  | 'files.rendering-diagram'
  | 'files.new-file'
  | 'files.new-folder'
  | 'files.rename'
  | 'files.rename-to'
  | 'files.copy'
  | 'files.copy-to'
  | 'files.delete'
  | 'files.delete-confirm'
  | 'files.search-placeholder'
  | 'files.op-failed'
  | 'dialog.ok'
  | 'dialog.cancel'
  | 'files.viewer.binary'
  | 'files.viewer.html'
  | 'files.viewer.markdown'
  | 'files.viewer.text'
  | 'files.viewer.html-unlock'
  | 'files.viewer.html-restore'
  | 'files.viewer.html-unsandboxed-warning'
  | 'files.selection-add'
  | 'files.selection-over-limit'
  | 'files.refresh'
  | 'files.new'
  | 'files.more-actions'
  | 'side.close'
  | 'side.git'
  | 'side.add-tool'
  | 'side.no-more-tools'
  | 'side.close-named-tab'
  | 'side.not-ready'
  | 'side.orphaned-tab'
  | 'side.no-workspace'
  | 'center.tablist'
  | 'center.close'
  | 'center.crash'
  | 'side.tab-limit'
  | 'side.tool-disabled'
  | 'side.tool-missing'
  // // unwired-capability (leaf-R2 ②): bottom-workbench message keys restored
  // // from HEAD — the workbench is dormant, but the keys keep the type
  // // complete so `bottom-workbench.tsx` typechecks and re-wires trivially.
  | 'bottom-workbench.title'
  | 'bottom-workbench.tabs'
  | 'bottom-workbench.empty'
  | 'settings.title'
  | 'settings.description'
  | 'settings.reset'
  | 'settings.open-by-default'
  | 'settings.open-by-default-description'
  | 'settings.center-preview-tabs'
  | 'settings.center-preview-tabs-description'
  | 'settings.layout-scope'
  | 'settings.layout-scope-description'
  | 'comments.add'
  | 'comments.add-line'
  | 'comments.placeholder'
  | 'comments.reference'
  | 'comments.comment-on-line'
  | 'comments.comment-on-lines'
  | 'comments.delete'
  | 'selection.title'
  | 'selection.add-to-chat'
  | 'selection.pick-conversation'
  | 'selection.target-current'
  | 'selection.ask-in-side-chat'
  | 'selection.comment'
  | 'selection.edit'
  | 'selection.edit-input'
  | 'selection.edit-placeholder'
  | 'selection.edit-submit'
  | 'selection.copy-ref'
  | 'selection.copied'
  | 'selection.copy-failed'
  | 'selection.send-unavailable'
  | 'selection.edit-unavailable'
  // Relative-time bucket keys (C37): shared with desktop-left-rail's `time.*`
  // so the selection pill and the left rail render the same localized shapes.
  | 'time.now'
  | 'time.minutes'
  | 'time.hours'
  | 'time.days'
  | 'time.months'
  | 'time.years'
  | 'time.ago'
  | 'settings.width'
  | 'settings.width-value'
  | 'settings.tools'
  | 'settings.tools-description'
  | 'settings.viewers'
  | 'settings.viewers-description'
  | 'settings.layout'
  | 'settings.layout-description'
  | 'settings.behavior'
  | 'settings.behavior-description'
  | 'settings.agent-capabilities'
  | 'settings.agent-capabilities-description'
  | 'settings.agent-terminal-tools'
  | 'settings.agent-terminal-tools-description'
  | 'settings.agent-worktree-tools'
  | 'settings.agent-worktree-tools-description'
  | 'settings.agent-worktree-delegation-tools'
  | 'settings.agent-worktree-delegation-tools-description'
  | 'settings.open-files'
  | 'settings.open-files-description'
  | 'settings.open-links'
  | 'settings.open-links-description'
  | 'settings.open-links-http'
  | 'settings.open-links-http-description'
  | 'settings.open-links-https'
  | 'settings.open-links-https-description'
  | 'settings.html-no-sandbox'
  | 'settings.html-no-sandbox-description'
  | 'settings.html-default-unsafe'
  | 'settings.html-default-unsafe-description'
  | 'settings.terminal-font-family'
  | 'settings.terminal-font-family-description'
  | 'settings.terminal-font-family-placeholder'
  | 'settings.terminal-font-size'
  | 'settings.terminal-font-size-description'
  | 'settings.terminal-shell'
  | 'settings.terminal-shell-description'
  | 'settings.terminal-shell-placeholder'
  | 'settings.terminal-scrollback-rows'
  | 'settings.terminal-scrollback-rows-description'
  | 'settings.terminal-reconnect-grace-ms'
  | 'settings.terminal-reconnect-grace-ms-description'
  | 'settings.terminal-process-kill-grace-ms'
  | 'settings.terminal-process-kill-grace-ms-description'
  | 'settings.terminal-retained-inactive-sessions'
  | 'settings.terminal-retained-inactive-sessions-description'
  | 'settings.terminal-mouse-wheel-multiplier'
  | 'settings.terminal-mouse-wheel-multiplier-description'
  | 'settings.terminal-ligatures'
  | 'settings.terminal-ligatures-description'
  | 'settings.terminal-gpu-acceleration'
  | 'settings.terminal-gpu-acceleration-description'
  | 'settings.terminal-gpu-acceleration-placeholder'
  | 'settings.auto-open-subagent'
  | 'settings.auto-open-subagent-description'
  | 'settings.auto-open-jobs'
  | 'settings.auto-open-jobs-description'
  | 'settings.runtime-load-failed'
  | 'settings.runtime-save-failed'
  | 'settings.feature-settings'
  | 'settings.plugin-settings'
  | 'settings.no-feature-settings'
  | 'settings.done'
  | 'workspace.title'
  | 'workspace.select'
  | 'workspace.changes'
  | 'workspace.committed'
  | 'workspace.more-changes'
  | 'workspace.clean'
  | 'workspace.not-git'
  | 'workspace.current-branch'
  | 'workspace.commit-message'
  | 'workspace.commit-all'
  | 'workspace.commit-staged-all'
  | 'workspace.commit-publish'
  | 'workspace.commit-force-push'
  | 'workspace.commit-force-push-confirm'
  | 'workspace.commit-abort-confirm'
  | 'workspace.commit-pull'
  | 'workspace.commit-sync'
  | 'workspace.commit-fetch'
  | 'workspace.commit-abort-merge'
  | 'workspace.commit-abort-rebase'
  | 'workspace.commit-actions'
  | 'workspace.commit-generate'
  | 'workspace.commit-generation-cancel'
  | 'workspace.commit-action-busy'
  | 'workspace.commit-action-no-changes'
  | 'workspace.commit-action-message-required'
  | 'workspace.commit-action-conflict'
  | 'workspace.commit-action-no-remote'
  | 'workspace.commit-action-no-upstream'
  | 'workspace.commit-action-detached'
  | 'workspace.commit-action-up-to-date'
  | 'workspace.push'
  | 'source-control-ai.title'
  | 'source-control-ai.description'
  | 'source-control-ai.refresh'
  | 'source-control-ai.loading'
  | 'source-control-ai.enabled'
  | 'source-control-ai.model'
  | 'source-control-ai.default-model'
  | 'source-control-ai.reasoning'
  | 'source-control-ai.provider-default'
  | 'source-control-ai.prompt-template'
  | 'source-control-ai.variables'
  | 'source-control-ai.save'
  | 'source-control-ai.saved'
  | 'workspace.behind'
  | 'workspace.loading-diff'
  | 'workspace.no-text-diff'
  | 'workspace.no-content-changes'
  | 'workspace.renamed-only'
  | 'workspace.review-history'
  | 'workspace.no-commits'
  | 'workspace.commit-no-files'
  | 'source-control.section.conflict'
  | 'source-control.section.staged'
  | 'source-control.section.unstaged'
  | 'source-control.mode.flat'
  | 'source-control.mode.tree'
  | 'source-control.status.added'
  | 'source-control.status.modified'
  | 'source-control.status.deleted'
  | 'source-control.status.renamed'
  | 'source-control.status.copied'
  | 'source-control.status.untracked'
  | 'source-control.status.conflicted'
  | 'source-control.stage'
  | 'source-control.unstage'
  | 'source-control.discard'
  | 'source-control.stage-all'
  | 'source-control.unstage-all'
  | 'source-control.discard-all'
  | 'source-control.view-all'
  | 'source-control.copy-path'
  | 'source-control.discard-confirm'
  | 'toast.copied'
  | 'toast.copy-failed'
  | 'toast.save-failed'
  | 'toast.discarded'
  | 'overlay.loading'
  | 'overlay.no-content'
  | 'overlay.retry'
  | 'diff.layout.unified'
  | 'diff.layout.split'
  | 'diff.change-prev'
  | 'diff.change-next'
  | 'diff.comment-actions'
  | 'diff.comment-resolve'
  | 'diff.comment-reopen'
  | 'diff.comment-delete'
  | 'diff.wrap'
  | 'diff.too-large'
  | 'diff.truncated'
  | 'diff.expand-context'
  | 'diff.expand-context-file'
  | 'file.save'
  | 'file.saving'
  | 'files.view'
  | 'files.edit'
  | 'files.viewer.source'
  | 'files.viewer.preview'
  | 'files.partial'
  | 'conflict.resolve-and-stage'
  | 'conflict.resolving'
  | 'conflict.accept-current'
  | 'conflict.accept-incoming'
  | 'conflict.keep-both'

export const WORKSPACE_MESSAGES: LocaleMessages<WorkspaceMessage> = {
  en: {
    'side.expand': 'Expand side panel',
    'side.restore': 'Restore side panel',
    'summary.title': 'Pinned summary',
    'terminal.toggle': 'Toggle terminal panel',
    'terminal.title': 'Terminal',
    'terminal.process-exited': 'process exited with code {code}',
    'terminal.unknown': 'unknown',
    'terminal.error': 'terminal error: {message}',
    'add.open': 'Add browser, terminal or conversation',
    'add.new-conversation': 'New conversation',
    'side.toggle': 'Toggle side panel',
    'side.title': 'Side panel',
    review: 'Review',
    terminal: 'Terminal',
    browser: 'Browser',
    files: 'Files',
    'side-chat': 'Side chat',
    trajectory: 'Trajectory',
    subagent: 'Subagents',
    'subagent.topology': 'Subagent topology',
    'subagent.jobs': 'Background jobs',
    'subagent.no-topology': 'No subagent topology available for this runtime.',
    'subagent.no-jobs': 'No background jobs in this conversation.',
    'subagent.main-session': 'Main agent',
    'subagent.current': 'current',
    'subagent.refresh': 'Refresh',
    'subagent.output': 'Output',
    'subagent.kill': 'Kill',
    'subagent.job-output-empty': '(no output read yet)',
    'subagent.job-output-failed': 'Could not read the job output.',
    'browser.enter-url': 'Enter a URL',
    'browser.http-only': 'Only HTTP and HTTPS URLs are supported',
    'browser.page-failed': 'Page failed to load',
    'browser.back': 'Browser back',
    'browser.reload': 'Reload browser',
    'browser.url': 'Browser URL',
    'files.select-workspace': 'Select a workspace to browse files.',
    'files.loading': 'Loading…',
    'files.empty-directory': 'Empty directory',
    'files.open': 'Open',
    'files.preview-truncated': 'preview truncated',
    'files.not-file': 'The selected path is not a regular file.',
    'files.no-viewer': 'No preview is available for this file ({size}).',
    'files.empty-file': 'Empty file',
    'files.empty-notebook': 'Empty notebook',
    'files.file-path': 'File path',
    'files.table-of-contents': 'Table of contents',
    'files.search-no-matches': 'No matches',
    'files.search-unavailable': 'Search unavailable',
    'files.image-loading': 'Loading image…',
    'files.image-load-failed': 'Could not load image.',
    'files.zoom-out': 'Zoom out',
    'files.zoom-in': 'Zoom in',
    'files.zoom-reset': 'Reset',
    'files.open-externally': 'Open externally',
    'files.rendering-diagram': 'Rendering diagram…',
    'files.new-file': 'New file',
    'files.new-folder': 'New folder',
    'files.rename': 'Rename',
    'files.rename-to': 'Rename to',
    'files.copy': 'Copy',
    'files.copy-to': 'Copy to',
    'files.delete': 'Delete',
    'files.delete-confirm': 'Delete "{path}"?',
    'files.search-placeholder': 'Search files…',
    'files.op-failed': 'Operation failed',
    'dialog.ok': 'OK',
    'dialog.cancel': 'Cancel',
    'files.viewer.binary': 'Binary file',
    'files.viewer.html': 'HTML preview',
    'files.viewer.markdown': 'Markdown preview',
    'files.viewer.text': 'Text preview',
    'files.viewer.html-unlock': 'Unlock HTML preview',
    'files.viewer.html-restore': 'Restore sandbox',
    'files.viewer.html-unsandboxed-warning': 'Unsandboxed preview — the page can read session files and act as the GUI. Only for trusted local content.',
    'files.selection-add': 'Add to conversation',
    'files.selection-over-limit': 'Selection too large — inserting path only',
    'files.refresh': 'Refresh',
    'files.new': 'New file or folder',
    'files.more-actions': 'More actions',
    'side.close': 'Close side panel',
    'side.git': 'Git',
    'side.add-tool': 'Add tool',
    'side.no-more-tools': 'No more tools to add',
    'side.close-named-tab': 'Close {title}',
    'side.not-ready': 'The side panel is still starting.',
    'side.no-workspace': 'Select a workspace to use this tool.',
    'side.orphaned-tab': 'Its provider is not currently available. You can close this tab without losing the rest of the session.',
    'center.tablist': 'Center tabs',
    'center.close': 'Close tab',
    'center.crash': 'The file area failed to render.',
    'side.tab-limit': 'Close an existing tab before opening another.',
    'side.tool-disabled': 'This side panel tool is disabled.',
    'side.tool-missing': 'This side panel tool is no longer registered.',
    'bottom-workbench.title': 'Bottom workbench',
    'bottom-workbench.tabs': 'Bottom workbench tabs',
    'bottom-workbench.empty': 'Drag a tab here to open a second workbench at the bottom',
    'settings.title': 'Side panel',
    'settings.description': 'Choose which tools and file previews are available in the desktop side panel.',
    'settings.reset': 'Reset',
    'settings.open-by-default': 'Open at launch',
    'settings.open-by-default-description': 'Restore the side panel automatically when the desktop starts.',
    'settings.center-preview-tabs': 'Single-click previews',
    'settings.center-preview-tabs-description':
      'Open files from clicks as replaceable preview tabs. Turn off to always open permanent tabs.',
    'comments.add': 'Comment',
    'comments.add-line': 'Add comment',
    'comments.placeholder': 'Leave a comment — Enter sends, Shift+Enter for a newline',
    'comments.reference': 'Reference in chat',
    'comments.comment-on-line': 'Comment on line {line}',
    'comments.comment-on-lines': 'Comment on lines {startLine}–{endLine}',
    'comments.delete': 'Delete',
    'selection.title': 'Selection actions',
    'selection.add-to-chat': 'Add to chat',
    'selection.pick-conversation': 'Send to another conversation',
    'selection.target-current': 'current',
    'selection.ask-in-side-chat': 'Ask in side chat',
    'selection.comment': 'Comment',
    'selection.edit': 'Edit',
    'selection.edit-input': 'Edit instruction',
    'selection.edit-placeholder': 'Describe the edit…',
    'selection.edit-submit': 'Submit edit instruction',
    'selection.copy-ref': 'Copy reference',
    'selection.copied': 'Copied',
    'selection.copy-failed': 'Copy failed',
    'selection.send-unavailable': 'No reachable conversation to send to',
    'selection.edit-unavailable': 'No reachable conversation to apply the edit',
    'time.now': 'now',
    'time.minutes': '{n}min',
    'time.hours': '{n}h',
    'time.days': '{n}d',
    'time.months': '{n}mo',
    'time.years': '{n}y',
    'time.ago': '{t} ago',
    'settings.layout-scope': 'Cross-project layout',
    'settings.layout-scope-description':
      'Share one side-panel tab layout across every project. Turn off to keep a separate layout per project.',
    'settings.width': 'Default width',
    'settings.width-value': '{width} px',
    'settings.tools': 'Tools',
    'settings.tools-description': 'Disabled tools are removed from the side panel launcher.',
    'settings.viewers': 'File previews',
    'settings.viewers-description': 'Higher-priority enabled previews are selected automatically.',
    'settings.layout': 'Layout',
    'settings.layout-description': 'Side panel placement and sizing, shared across conversations.',
    'settings.behavior': 'Opening behavior',
    'settings.behavior-description': 'How chat-side files, links, previews, and panels open.',
    'settings.agent-capabilities': 'Agent capabilities',
    'settings.agent-capabilities-description': 'Capabilities the agent may use. Each is disabled by default.',
    'settings.agent-terminal-tools': 'Terminal tools for agents',
    'settings.agent-terminal-tools-description': 'Allow agents to create and control desktop terminals. This is disabled by default.',
    'settings.agent-worktree-tools': 'WorkTree tools for agents',
    'settings.agent-worktree-tools-description': 'Allow agents to inspect visible WorkTrees, create branches, and manage linked WorkTrees (list, branches, status, create, remove). This is disabled by default.',
    'settings.agent-worktree-delegation-tools': 'WorkTree delegation tools for agents',
    'settings.agent-worktree-delegation-tools-description': 'Allow agents to start independent conversations in visible WorkTrees and manage them (delegate, status, wait, stop, result). This is disabled by default.',
    'settings.open-files': 'Open chat files in the side panel',
    'settings.open-files-description': 'Open workspace file links from messages and tool results in the desktop file viewer.',
    'settings.open-links': 'Open external links in the side browser',
    'settings.open-links-description': 'Open plain HTTP and HTTPS link clicks in the desktop browser. Cmd/Ctrl-click still opens them externally.',
    'settings.open-links-http': 'Open http links in the side browser',
    'settings.open-links-http-description': 'Route plain http links into the desktop browser.',
    'settings.open-links-https': 'Open https links in the side browser',
    'settings.open-links-https-description': 'Route plain https links into the desktop browser. Off by default: most https sites refuse iframe embedding.',
    'settings.html-no-sandbox': 'Run HTML previews unsandboxed',
    'settings.html-no-sandbox-description': 'Drop the sandbox for every HTML preview. The previewed page can then read session files and internal APIs — only for trusted local content.',
    'settings.html-default-unsafe': 'Open new HTML previews unsandboxed',
    'settings.html-default-unsafe-description': 'Start every preview in the unsandboxed state; the status row still offers a one-tap restore.',
    'settings.terminal-font-family': 'Terminal font family',
    'settings.terminal-font-family-description': 'A CSS font-family stack for terminal tabs; empty follows the theme monospace font.',
    'settings.terminal-font-family-placeholder': 'Follow the theme font',
    'settings.terminal-font-size': 'Terminal font size',
    'settings.terminal-font-size-description': 'Font size in px for terminal tabs (9–32).',
    'settings.terminal-shell': 'Terminal shell',
    'settings.terminal-shell-description': 'Explicit shell for terminal tabs; empty follows DSH_SIDEBAR_SHELL, then the platform default. New terminals only.',
    'settings.terminal-shell-placeholder': 'Follow the platform default',
    'settings.terminal-scrollback-rows': 'Scrollback rows',
    'settings.terminal-scrollback-rows-description': 'Max scrollback rows for terminal tabs (1000–50000). Takes effect for new terminals.',
    'settings.terminal-reconnect-grace-ms': 'Reconnect grace',
    'settings.terminal-reconnect-grace-ms-description': 'How long a tab switch preserves the shell (0–120000 ms). New terminals only.',
    'settings.terminal-process-kill-grace-ms': 'Process kill grace',
    'settings.terminal-process-kill-grace-ms-description': 'SIGTERM to SIGKILL escalation delay (250–10000 ms). New terminals only.',
    'settings.terminal-retained-inactive-sessions': 'Retained inactive sessions',
    'settings.terminal-retained-inactive-sessions-description': 'Maximum inactive terminal sessions kept for restore (0–1024).',
     'settings.terminal-mouse-wheel-multiplier': 'Mouse wheel multiplier',
     'settings.terminal-mouse-wheel-multiplier-description': 'Scale terminal wheel scrolling from 0.25× to 4×.',
     'settings.terminal-ligatures': 'Terminal ligatures',
     'settings.terminal-ligatures-description': 'Enable ligature rendering when the optional renderer is available.',
     'settings.terminal-gpu-acceleration': 'GPU acceleration',
     'settings.terminal-gpu-acceleration-description': 'Use auto, on, or off for the optional WebGL renderer.',
     'settings.terminal-gpu-acceleration-placeholder': 'auto | on | off',
    'settings.auto-open-subagent': 'Open on new subagents',
    'settings.auto-open-subagent-description': 'Automatically open the sidebar on the subagent page when the current conversation spawns a subagent.',
    'settings.auto-open-jobs': 'Open on new background jobs',
    'settings.auto-open-jobs-description': 'Automatically open the sidebar on the jobs page when a new background job appears.',
    'settings.runtime-load-failed': 'Could not load the runtime settings.',
    'settings.runtime-save-failed': 'Could not save the runtime settings.',
    'settings.feature-settings': 'Settings',
    'settings.plugin-settings': 'Plugin settings',
    'settings.no-feature-settings': 'This feature has no additional settings.',
    'settings.done': 'Done',
    'workspace.title': 'Workspace',
    'workspace.select': 'Select a DSH workspace to inspect changes.',
    'workspace.changes': 'Changes',
    'workspace.committed': 'Committed changes',
    'workspace.more-changes': '{count} more changes',
    'workspace.clean': 'Working tree clean',
    'workspace.not-git': 'This directory is not a Git repository.',
    'workspace.current-branch': 'Current branch',
    'workspace.commit-message': 'Commit message',
    'workspace.commit-all': 'Commit all',
    'workspace.commit-staged-all': 'No staged changes — staged everything and committed.',
    'workspace.commit-publish': 'Publish branch',
    'workspace.commit-force-push': 'Force push with lease',
    'workspace.commit-force-push-confirm': 'Force push the current branch with lease protection?',
    'workspace.commit-abort-confirm': 'Abort the current Git operation and restore its pre-operation state?',
    'workspace.commit-pull': 'Pull (fast-forward only)',
    'workspace.commit-sync': 'Sync',
    'workspace.commit-fetch': 'Fetch',
    'workspace.commit-abort-merge': 'Abort merge',
    'workspace.commit-abort-rebase': 'Abort rebase',
    'workspace.commit-actions': 'More commit actions',
    'workspace.commit-generate': 'Generate commit message',
    'workspace.commit-generation-cancel': 'Cancel commit-message generation',
    'workspace.commit-action-busy': 'Another source-control action is running',
    'workspace.commit-action-no-changes': 'There are no changes to commit',
    'workspace.commit-action-message-required': 'Enter a commit message first',
    'workspace.commit-action-conflict': 'Resolve or abort the current Git operation first',
    'workspace.commit-action-no-remote': 'This repository has no Git remote',
    'workspace.commit-action-no-upstream': 'The current branch has no upstream',
    'workspace.commit-action-detached': 'Cannot publish from a detached HEAD',
    'workspace.commit-action-up-to-date': 'Already up to date',
    'workspace.push': 'Push',
    'source-control-ai.title': 'Source Control AI',
    'source-control-ai.description': 'Generate commit messages with the configured DSH model.',
    'source-control-ai.refresh': 'Refresh model list',
    'source-control-ai.loading': 'Loading...',
    'source-control-ai.enabled': 'Enable AI commit-message generation',
    'source-control-ai.model': 'Model',
    'source-control-ai.default-model': 'Use DSH default ({provider} / {model})',
    'source-control-ai.reasoning': 'Reasoning strength',
    'source-control-ai.provider-default': 'Provider default',
    'source-control-ai.prompt-template': 'Prompt template',
    'source-control-ai.variables': 'Supported variables: {repository}, {branch}, {stagedPatch}',
    'source-control-ai.save': 'Save',
    'source-control-ai.saved': 'Saved',
    'workspace.behind': 'Behind upstream by {count}',
    'workspace.loading-diff': 'Loading diff…',
    'workspace.no-text-diff': 'No textual diff is available.',
    'workspace.no-content-changes': 'No content changes.',
    'workspace.renamed-only': 'Renamed file — no content changes.',
    'workspace.review-history': 'Commit history',
    'workspace.no-commits': 'No commits on this branch',
    'workspace.commit-no-files': 'No file changes in this commit',
    'source-control.section.conflict': 'Conflicts',
    'source-control.section.staged': 'Staged',
    'source-control.section.unstaged': 'Unstaged',
    'source-control.mode.flat': 'Flat list',
    'source-control.mode.tree': 'Tree',
    'source-control.status.added': 'Added',
    'source-control.status.modified': 'Modified',
    'source-control.status.deleted': 'Deleted',
    'source-control.status.renamed': 'Renamed',
    'source-control.status.copied': 'Copied',
    'source-control.status.untracked': 'Untracked',
    'source-control.status.conflicted': 'Conflicted',
    'source-control.stage': 'Stage',
    'source-control.unstage': 'Unstage',
    'source-control.discard': 'Discard changes',
    'source-control.stage-all': 'Stage all',
    'source-control.unstage-all': 'Unstage all',
    'source-control.discard-all': 'Discard all',
    'source-control.view-all': 'View all',
    'source-control.copy-path': 'Copy path',
    'source-control.discard-confirm': 'Discard changes in "{paths}"? This cannot be undone.',
    'toast.copied': 'Copied to clipboard',
    'toast.copy-failed': 'Copy failed',
    'toast.save-failed': 'Save failed: {message}',
    'toast.discarded': 'Changes discarded',
    'overlay.loading': 'Loading…',
    'overlay.no-content': 'No preview available.',
    'overlay.retry': 'Retry',
    'diff.layout.unified': 'Unified view',
    'diff.layout.split': 'Side-by-side view',
    'diff.change-prev': 'Previous change ({hint})',
    'diff.change-next': 'Next change ({hint})',
    'diff.comment-actions': 'Comment actions',
    'diff.comment-resolve': 'Resolve',
    'diff.comment-reopen': 'Reopen',
    'diff.comment-delete': 'Delete',
    'diff.wrap': 'Wrap long lines',
    'diff.too-large': 'Diff too large to render inline ({lines} lines).',
    'diff.truncated': 'Diff truncated to {lines} lines.',
    'diff.expand-context': 'Expand context ({current} → {next})',
    'diff.expand-context-file': 'Expand context',
    'file.save': 'Save',
    'file.saving': 'Saving…',
    'files.view': 'View',
    'files.edit': 'Edit in built-in editor',
    'files.viewer.source': 'Source',
    'files.viewer.preview': 'Preview',
    'files.partial': 'Shown partially',
    'conflict.resolve-and-stage': 'Resolve and stage',
    'conflict.resolving': 'Resolving…',
    'conflict.accept-current': 'Accept current',
    'conflict.accept-incoming': 'Accept incoming',
    'conflict.keep-both': 'Keep both',
  },
  zh: {
    'side.expand': '展开侧边栏',
    'side.restore': '恢复侧边栏',
    'summary.title': '固定摘要',
    'terminal.toggle': '切换终端面板',
    'terminal.title': '终端',
    'terminal.process-exited': '进程已退出，代码 {code}',
    'terminal.unknown': '未知',
    'terminal.error': '终端错误：{message}',
    'add.open': '添加浏览器、终端或新对话',
    'add.new-conversation': '新对话',
    'side.toggle': '切换侧边栏',
    'side.title': '侧边栏',
    review: '审查',
    terminal: '终端',
    browser: '浏览器',
    files: '文件',
    'side-chat': '侧边对话',
    trajectory: '轨迹',
    subagent: '子代理',
    'subagent.topology': '子代理拓扑',
    'subagent.jobs': '后台任务',
    'subagent.no-topology': '当前运行时没有可用的子代理拓扑数据。',
    'subagent.no-jobs': '此对话暂无后台任务。',
    'subagent.main-session': '主代理',
    'subagent.current': '当前',
    'subagent.refresh': '刷新',
    'subagent.output': '输出',
    'subagent.kill': '终止',
    'subagent.job-output-empty': '（暂无已读取的输出）',
    'subagent.job-output-failed': '无法读取任务输出。',
    'browser.enter-url': '输入 URL',
    'browser.http-only': '仅支持 HTTP 和 HTTPS URL',
    'browser.page-failed': '页面加载失败',
    'browser.back': '浏览器后退',
    'browser.reload': '重新加载浏览器',
    'browser.url': '浏览器 URL',
    'files.select-workspace': '选择工作区以浏览文件。',
    'files.loading': '加载中…',
    'files.empty-directory': '空目录',
    'files.open': '打开',
    'files.preview-truncated': '预览已截断',
    'files.not-file': '所选路径不是常规文件。',
    'files.no-viewer': '此文件没有可用的预览（{size}）。',
    'files.empty-file': '空文件',
    'files.empty-notebook': '空笔记本',
    'files.file-path': '文件路径',
    'files.table-of-contents': '目录',
    'files.search-no-matches': '无匹配结果',
    'files.search-unavailable': '搜索不可用',
    'files.image-loading': '加载图片中…',
    'files.image-load-failed': '图片加载失败。',
    'files.zoom-out': '缩小',
    'files.zoom-in': '放大',
    'files.zoom-reset': '重置',
    'files.open-externally': '在外部打开',
    'files.rendering-diagram': '渲染图表中…',
    'files.new-file': '新建文件',
    'files.new-folder': '新建文件夹',
    'files.rename': '重命名',
    'files.rename-to': '重命名为',
    'files.copy': '复制',
    'files.copy-to': '复制为',
    'files.delete': '删除',
    'files.delete-confirm': '确定删除 "{path}"？',
    'files.search-placeholder': '搜索文件…',
    'files.op-failed': '操作失败',
    'dialog.ok': '确定',
    'dialog.cancel': '取消',
    'files.viewer.binary': '二进制文件',
    'files.viewer.html': 'HTML 预览',
    'files.viewer.markdown': 'Markdown 预览',
    'files.viewer.text': '文本预览',
    'files.viewer.html-unlock': '解锁 HTML 预览',
    'files.viewer.html-restore': '恢复沙箱',
    'files.viewer.html-unsandboxed-warning': '非沙箱预览 — 页面可读取会话文件并以 GUI 身份操作。仅用于受信任的本地内容。',
    'files.selection-add': '添加到对话',
    'files.selection-over-limit': '选区过大 — 仅插入路径行',
    'files.refresh': '刷新',
    'files.new': '新建文件或文件夹',
    'files.more-actions': '更多操作',
    'side.close': '关闭侧边栏',
    'side.git': 'Git',
    'side.add-tool': '添加工具',
    'side.no-more-tools': '没有更多可添加的工具',
    'side.close-named-tab': '关闭 {title}',
    'side.not-ready': '侧边栏仍在启动。',
    'side.no-workspace': '请先选择工作区再使用此工具。',
    'side.orphaned-tab': '当前无法找到它的提供者。关闭此标签页不会影响会话中的其他内容。',
    'center.tablist': '中间标签页',
    'center.close': '关闭标签页',
    'center.crash': '文件区域渲染失败。',
    'side.tab-limit': '请先关闭一个已有标签页。',
    'side.tool-disabled': '此侧边栏工具已被禁用。',
    'side.tool-missing': '此侧边栏工具已不再注册。',
    'bottom-workbench.title': '底部工作台',
    'bottom-workbench.tabs': '底部工作台标签页',
    'bottom-workbench.empty': '将标签页拖到这里，在底部打开第二个工作台',
    'settings.title': '侧边栏',
    'settings.description': '选择桌面侧边栏中可用的工具和文件预览。',
    'settings.reset': '恢复默认',
    'settings.open-by-default': '启动时打开',
    'settings.open-by-default-description': '桌面端启动时自动恢复侧边栏。',
    'settings.center-preview-tabs': '单击预览',
    'settings.center-preview-tabs-description': '单击文件时打开可替换的预览标签；关闭后单击直接打开永久标签。',
    'comments.add': '评论',
    'comments.add-line': '添加评论',
    'comments.placeholder': '输入评论——Enter 发送，Shift+Enter 换行',
    'comments.reference': '引用到对话',
    'comments.comment-on-line': '评论第 {line} 行',
    'comments.comment-on-lines': '评论第 {startLine} 至 {endLine} 行',
    'comments.delete': '删除',
    'selection.title': '选中操作',
    'selection.add-to-chat': '添加到对话',
    'selection.pick-conversation': '发送到其他对话',
    'selection.target-current': '当前',
    'selection.ask-in-side-chat': '在侧边聊天中提问',
    'selection.comment': '评论',
    'selection.edit': '编辑',
    'selection.edit-input': '编辑说明',
    'selection.edit-placeholder': '描述编辑内容…',
    'selection.edit-submit': '提交编辑指令',
    'selection.copy-ref': '复制引用',
    'selection.copied': '已复制',
    'selection.copy-failed': '复制失败',
    'selection.send-unavailable': '没有可接收的会话，无法发送',
    'selection.edit-unavailable': '没有可接收的会话，无法应用编辑',
    'time.now': '刚刚',
    'time.minutes': '{n}分钟',
    'time.hours': '{n}小时',
    'time.days': '{n}天',
    'time.months': '{n}个月',
    'time.years': '{n}年',
    'time.ago': '{t}前',
    'settings.layout-scope': '跨项目共享布局',
    'settings.layout-scope-description': '所有项目共用同一份侧栏标签布局；关闭后每个项目保留各自的布局。',
    'settings.width': '默认宽度',
    'settings.width-value': '{width} 像素',
    'settings.tools': '工具',
    'settings.tools-description': '禁用的工具会从侧边栏启动器中移除。',
    'settings.viewers': '文件预览',
    'settings.viewers-description': '系统会自动选择优先级更高且已启用的预览器。',
    'settings.layout': '布局',
    'settings.layout-description': '侧边栏位置与尺寸，跨对话共享。',
    'settings.behavior': '打开行为',
    'settings.behavior-description': '聊天中的文件、链接、预览与面板的打开方式。',
    'settings.agent-capabilities': 'Agent 能力',
    'settings.agent-capabilities-description': '允许 Agent 使用的能力；默认全部关闭。',
    'settings.agent-terminal-tools': '允许 Agent 使用终端工具',
    'settings.agent-terminal-tools-description': '允许 Agent 创建并控制桌面终端；默认关闭。',
    'settings.agent-worktree-tools': '允许 Agent 使用 WorkTree 工具',
    'settings.agent-worktree-tools-description': '允许 Agent 查看可见 WorkTree、创建分支并管理工作树本身（列表、分支、状态、新建、删除）；默认关闭。',
    'settings.agent-worktree-delegation-tools': '允许 Agent 发起 WorkTree 委托对话',
    'settings.agent-worktree-delegation-tools-description': '允许 Agent 在可见 WorkTree 中启动独立对话并管理其生命周期（发起、状态、等待、停止、取结果）；默认关闭。',
    'settings.open-files': '聊天文件在侧边栏打开',
    'settings.open-files-description': '消息和工具结果中的工作区文件链接，会在桌面文件预览器中打开。',
    'settings.open-links': '外部链接在侧边浏览器打开',
    'settings.open-links-description': '普通 HTTP/HTTPS 链接会在桌面浏览器中打开；Cmd/Ctrl 点击仍使用外部浏览器。',
    'settings.open-links-http': 'http 链接在侧边浏览器打开',
    'settings.open-links-http-description': '普通 http 链接在桌面浏览器中打开。',
    'settings.open-links-https': 'https 链接在侧边浏览器打开',
    'settings.open-links-https-description': '普通 https 链接在桌面浏览器中打开。默认关闭：多数 https 站点拒绝 iframe 嵌入。',
    'settings.html-no-sandbox': 'HTML 预览以非沙箱方式运行',
    'settings.html-no-sandbox-description': '去掉所有 HTML 预览的沙箱。预览页面随后可读取会话文件与内部 API — 仅用于受信任的本地内容。',
    'settings.html-default-unsafe': '新打开 HTML 预览默认非沙箱',
    'settings.html-default-unsafe-description': '每个预览默认以非沙箱状态打开；状态行仍提供一键恢复。',
    'settings.terminal-font-family': '终端字体族',
    'settings.terminal-font-family-description': '终端标签页的 CSS font-family；留空跟随主题等宽字体。',
    'settings.terminal-font-family-placeholder': '跟随主题字体',
    'settings.terminal-font-size': '终端字号',
    'settings.terminal-font-size-description': '终端标签页的字号（px，9–32）。',
    'settings.terminal-shell': '终端 shell',
    'settings.terminal-shell-description': '终端标签页的显式 shell；留空则跟随 DSH_SIDEBAR_SHELL，再跟随平台默认。仅对新终端生效。',
    'settings.terminal-shell-placeholder': '跟随平台默认',
    'settings.terminal-scrollback-rows': '回滚行数',
    'settings.terminal-scrollback-rows-description': '终端标签页的最大回滚行数（1000–50000）。仅对新终端生效。',
    'settings.terminal-reconnect-grace-ms': '重连保护时间',
    'settings.terminal-reconnect-grace-ms-description': '切换标签页后保留 shell 的时间（0–120000 ms）。仅对新终端生效。',
    'settings.terminal-process-kill-grace-ms': '进程终止宽限',
    'settings.terminal-process-kill-grace-ms-description': 'SIGTERM 到 SIGKILL 的升级延迟（250–10000 ms）。仅对新终端生效。',
    'settings.terminal-retained-inactive-sessions': '保留的非活动终端会话',
    'settings.terminal-retained-inactive-sessions-description': '用于恢复的最大非活动终端会话数（0–1024）。',
     'settings.terminal-mouse-wheel-multiplier': '鼠标滚轮倍率',
     'settings.terminal-mouse-wheel-multiplier-description': '终端滚轮滚动倍率范围为 0.25× 到 4×。',
     'settings.terminal-ligatures': '终端连字',
     'settings.terminal-ligatures-description': '可用可选渲染器时启用连字显示。',
     'settings.terminal-gpu-acceleration': 'GPU 加速',
     'settings.terminal-gpu-acceleration-description': '可选 WebGL 渲染器支持 auto、on 或 off。',
     'settings.terminal-gpu-acceleration-placeholder': 'auto | on | off',
    'settings.auto-open-subagent': '出现新子代理时自动打开',
    'settings.auto-open-subagent-description': '当前会话派生子代理时，自动在侧边栏打开子代理页。',
    'settings.auto-open-jobs': '出现新后台任务时自动打开',
    'settings.auto-open-jobs-description': '出现新的后台任务时，自动在侧边栏打开任务页。',
    'settings.runtime-load-failed': '无法加载运行时设置。',
    'settings.runtime-save-failed': '无法保存运行时设置。',
    'settings.feature-settings': '设置',
    'settings.plugin-settings': '插件设置',
    'settings.no-feature-settings': '该功能没有附加设置。',
    'settings.done': '完成',
    'workspace.title': '工作区',
    'workspace.select': '选择 DSH 工作区以检查变更。',
    'workspace.changes': '变更',
    'workspace.committed': '已提交的更改',
    'workspace.more-changes': '还有 {count} 项变更',
    'workspace.clean': '工作树已清理',
    'workspace.not-git': '此目录不是 Git 仓库。',
    'workspace.current-branch': '当前分支',
    'workspace.commit-message': '提交信息',
    'workspace.commit-all': '提交全部',
    'workspace.commit-staged-all': '暂存区为空——已暂存全部变更并提交。',
    'workspace.commit-publish': '发布分支',
    'workspace.commit-force-push': '强制推送（带租约）',
    'workspace.commit-force-push-confirm': '确定使用租约保护强制推送当前分支吗？',
    'workspace.commit-abort-confirm': '确定中止当前 Git 操作并恢复到操作前状态吗？',
    'workspace.commit-pull': '拉取（仅快进）',
    'workspace.commit-sync': '同步',
    'workspace.commit-fetch': '获取更新',
    'workspace.commit-abort-merge': '中止合并',
    'workspace.commit-abort-rebase': '中止变基',
    'workspace.commit-actions': '更多提交操作',
    'workspace.commit-generate': '生成提交信息',
    'workspace.commit-generation-cancel': '取消生成提交信息',
    'workspace.commit-action-busy': '另一个源代码管理操作正在运行',
    'workspace.commit-action-no-changes': '没有可提交的更改',
    'workspace.commit-action-message-required': '请先输入提交信息',
    'workspace.commit-action-conflict': '请先解决或中止当前 Git 操作',
    'workspace.commit-action-no-remote': '此仓库没有 Git 远程仓库',
    'workspace.commit-action-no-upstream': '当前分支没有上游分支',
    'workspace.commit-action-detached': '无法从分离的 HEAD 发布',
    'workspace.commit-action-up-to-date': '已是最新状态',
    'workspace.push': '推送',
    'source-control-ai.title': '提交代码 AI',
    'source-control-ai.description': '使用配置的 DSH 模型生成提交信息。',
    'source-control-ai.refresh': '刷新模型列表',
    'source-control-ai.loading': '加载中...',
    'source-control-ai.enabled': '启用 AI 生成提交信息',
    'source-control-ai.model': '模型',
    'source-control-ai.default-model': '使用 DSH 默认模型（{provider} / {model}）',
    'source-control-ai.reasoning': '思考强度',
    'source-control-ai.provider-default': '模型默认值',
    'source-control-ai.prompt-template': '提示词模板',
    'source-control-ai.variables': '支持变量：{repository}、{branch}、{stagedPatch}',
    'source-control-ai.save': '保存',
    'source-control-ai.saved': '已保存',
    'workspace.behind': '落后上游 {count} 个提交',
    'workspace.loading-diff': '正在加载差异…',
    'workspace.no-text-diff': '没有可用的文本差异。',
    'workspace.no-content-changes': '没有内容变更。',
    'workspace.renamed-only': '文件被重命名 — 没有内容变更。',
    'workspace.review-history': '提交历史',
    'workspace.no-commits': '当前分支没有提交',
    'workspace.commit-no-files': '此提交没有文件变更',
    'source-control.section.conflict': '冲突',
    'source-control.section.staged': '已暂存',
    'source-control.section.unstaged': '未暂存',
    'source-control.mode.flat': '平铺列表',
    'source-control.mode.tree': '树形',
    'source-control.status.added': '新增',
    'source-control.status.modified': '已修改',
    'source-control.status.deleted': '已删除',
    'source-control.status.renamed': '已重命名',
    'source-control.status.copied': '已复制',
    'source-control.status.untracked': '未跟踪',
    'source-control.status.conflicted': '冲突',
    'source-control.stage': '暂存',
    'source-control.unstage': '取消暂存',
    'source-control.discard': '丢弃更改',
    'source-control.stage-all': '全部暂存',
    'source-control.unstage-all': '全部取消暂存',
    'source-control.discard-all': '全部丢弃',
    'source-control.view-all': '查看全部',
    'source-control.copy-path': '复制路径',
    'source-control.discard-confirm': '确定丢弃 "{paths}" 中的更改？此操作无法撤销。',
    'toast.copied': '已复制到剪贴板',
    'toast.copy-failed': '复制失败',
    'toast.save-failed': '保存失败：{message}',
    'toast.discarded': '已丢弃更改',
    'overlay.loading': '加载中…',
    'overlay.no-content': '没有可预览的内容。',
    'overlay.retry': '重试',
    'diff.layout.unified': '统一视图',
    'diff.layout.split': '分栏视图',
    'diff.change-prev': '上一处更改（{hint}）',
    'diff.change-next': '下一处更改（{hint}）',
    'diff.comment-actions': '评论操作',
    'diff.comment-resolve': '标记为已解决',
    'diff.comment-reopen': '重新打开',
    'diff.comment-delete': '删除',
    'diff.wrap': '自动换行',
    'diff.too-large': '差异过大，无法内联渲染（{lines} 行）。',
    'diff.truncated': '差异已截断（仅显示 {lines} 行）。',
    'diff.expand-context': '展开上下文（{current} → {next}）',
    'diff.expand-context-file': '展开上下文',
    'file.save': '保存',
    'file.saving': '保存中…',
    'files.view': '查看',
    'files.edit': '在编辑器内编辑',
    'files.viewer.source': '源代码',
    'files.viewer.preview': '预览',
    'files.partial': '仅显示部分内容',
    'conflict.resolve-and-stage': '解决并暂存',
    'conflict.resolving': '解决中…',
    'conflict.accept-current': '接受当前版本',
    'conflict.accept-incoming': '接受传入版本',
    'conflict.keep-both': '两者都保留',
  },
}
