/**
 * Application menu construction and editing context menu
 * (kernel-refactor leaf-2.3, target-design §4.2). Owns labels(),
 * buildMenu(), and attachEditingContextMenu().
 *
 * The module holds no lifecycle state: menu actions reach the controller,
 * the IPC command channel, and the dialog flows through MenuHost, which
 * src/main.ts supplies at composition time.
 */
import { app, BrowserWindow, clipboard, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import type {
  DesktopCommand,
  DesktopInfo,
} from './contracts.ts'
import type { AppController } from './app-controller.ts'
import { productNameForChannel } from './desktop-identity.ts'
import { ensureDesktopProfile } from './profile.ts'
import type { UserEnvironmentResolution } from './user-environment.ts'
import { userEnvironmentDiagnostics } from './user-environment.ts'

/** Host-provided facts and actions the application menu composes from. */
export interface MenuHost {
  controller(): AppController
  desktopInfo(): DesktopInfo
  userEnvironment(): UserEnvironmentResolution
  recentLogLines(count: number): string[]
  sendCommand(command: DesktopCommand): void
  chooseWorkspace(): Promise<void>
  installLocalPlugin(): Promise<void>
  openUpdateWindow(): Promise<void>
}

export interface MenuModule {
  buildMenu(): void
}

function labels() {
  const zh = app.getLocale().toLowerCase().startsWith('zh')
  return zh ? {
    checkUpdates: '检查更新…',
    dsh: 'DSH',
    focus: '聚焦输入框',
    installPlugin: '从文件夹安装插件…',
    newChat: '新建会话',
    openData: '打开 DSH 数据目录',
    openLogs: '打开日志目录',
    openPluginProfile: '打开插件配置目录',
    openWorkspace: '打开工作区…',
    restart: '重新启动 DSH Runtime',
    settings: '设置…',
    togglePanelMaximized: '展开或还原工具侧栏',
    togglePinnedSummary: '切换置顶摘要',
    toggleSidePanel: '切换工具侧栏',
    toggleWorkspacePanel: '切换工作区面板',
    toggleSidebar: '切换侧栏',
    browser: '浏览器',
    files: '文件',
    review: '审查',
    sideChat: '侧边会话',
    trajectory: '轨迹',
  } : {
    checkUpdates: 'Check for Updates...',
    dsh: 'DSH',
    focus: 'Focus Composer',
    installPlugin: 'Install Plugin from Folder…',
    newChat: 'New Chat',
    openData: 'Open DSH Data Folder',
    openLogs: 'Open Logs Folder',
    openPluginProfile: 'Open Plugin Profile Folder',
    openWorkspace: 'Open Workspace…',
    restart: 'Restart DSH Runtime',
    settings: 'Settings…',
    togglePanelMaximized: 'Expand or Restore Side Panel',
    togglePinnedSummary: 'Toggle Pinned Summary',
    toggleSidePanel: 'Toggle Side Panel',
    toggleWorkspacePanel: 'Toggle Workspace Panel',
    toggleSidebar: 'Toggle Sidebar',
    browser: 'Browser',
    files: 'Files',
    review: 'Review',
    sideChat: 'Side Chat',
    trajectory: 'Trajectory',
  }
}

export function createMenuModule(host: MenuHost): MenuModule {
  function buildMenu(): void {
    const text = labels()
    const info = host.desktopInfo()
    const profile = ensureDesktopProfile(info.dshHome)
    const template: MenuItemConstructorOptions[] = [
      {
        label: productNameForChannel(info.channel),
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: text.checkUpdates, click: () => { void host.openUpdateWindow() } },
          { type: 'separator' },
          { label: text.settings, accelerator: 'CmdOrCtrl+,', click: () => { host.sendCommand({ type: 'show-settings' }) } },
          ...(process.platform === 'darwin'
            ? [
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
            ]
            : []),
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          { label: text.newChat, accelerator: 'CmdOrCtrl+N', click: () => { host.sendCommand({ type: 'new-session' }) } },
          { label: text.openWorkspace, accelerator: 'CmdOrCtrl+O', click: () => { void host.chooseWorkspace() } },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: text.toggleSidebar, accelerator: 'CmdOrCtrl+B', click: () => { host.sendCommand({ type: 'toggle-sidebar' }) } },
          { label: text.togglePanelMaximized, click: () => { host.sendCommand({ type: 'toggle-panel-maximized' }) } },
          { label: text.togglePinnedSummary, click: () => { host.sendCommand({ type: 'toggle-pinned-summary' }) } },
          { label: text.toggleSidePanel, accelerator: 'Alt+CmdOrCtrl+B', click: () => { host.sendCommand({ type: 'toggle-side-panel' }) } },
          { type: 'separator' },
          { label: text.review, accelerator: 'Ctrl+Shift+G', click: () => { host.sendCommand({ type: 'open-review' }) } },
          { label: text.browser, accelerator: 'CmdOrCtrl+T', click: () => { host.sendCommand({ type: 'open-browser' }) } },
          { label: text.files, accelerator: 'CmdOrCtrl+P', click: () => { host.sendCommand({ type: 'open-files' }) } },
          { label: text.sideChat, accelerator: 'Alt+CmdOrCtrl+S', click: () => { host.sendCommand({ type: 'open-side-chat' }) } },
          { label: text.trajectory, click: () => { host.sendCommand({ type: 'open-trajectory' }) } },
          { label: text.toggleWorkspacePanel, click: () => { host.sendCommand({ type: 'toggle-workspace-panel' }) } },
          { type: 'separator' },
          { label: text.focus, accelerator: 'CmdOrCtrl+L', click: () => { host.sendCommand({ type: 'focus-composer' }) } },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: text.dsh,
        submenu: [
          { label: text.restart, accelerator: 'CmdOrCtrl+Shift+R', click: () => { void host.controller().restart() } },
          { type: 'separator' },
          { label: text.installPlugin, click: () => { void host.installLocalPlugin() } },
          { label: text.openPluginProfile, click: () => { void shell.openPath(profile.profileDir) } },
          { type: 'separator' },
          { label: text.openData, click: () => { void shell.openPath(info.dshHome) } },
          { label: text.openLogs, click: () => { void shell.openPath(join(info.appDataPath, 'logs')) } },
          { type: 'separator' },
          {
            label: 'Copy Diagnostics',
            click: () => {
              clipboard.writeText([
                `${productNameForChannel(info.channel)} ${info.version}`,
                `channel=${info.channel}`,
                `home=${info.dshHome}`,
                `platform=${process.platform} ${process.arch}`,
                `profile=${info.profile}`,
                `runtime=${host.controller().runtimeUrl()?.href ?? 'stopped'}`,
                '',
                ...userEnvironmentDiagnostics(host.userEnvironment()),
                'git-config-mode=user-runtime / isolated-marketplace',
                ...host.recentLogLines(80),
              ].join('\n'))
            },
          },
        ],
      },
      { role: 'windowMenu' },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  return { buildMenu }
}

/**
 * Attach the native editing context menu (cut/copy/paste/selectAll/undo/redo)
 * to a webContents. Without this, right-click in input fields and text areas
 * shows nothing on macOS/Windows/Linux — the user has no way to copy or paste
 * except via keyboard shortcuts, which many users expect from the right-click.
 */
export function attachEditingContextMenu(contents: Electron.WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      template.push(
        { role: 'undo', accelerator: 'CmdOrCtrl+Z' },
        { role: 'redo', accelerator: 'CmdOrCtrl+Shift+Z' },
        { type: 'separator' },
        { role: 'cut', accelerator: 'CmdOrCtrl+X' },
        { role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { role: 'paste', accelerator: 'CmdOrCtrl+V' },
        { type: 'separator' },
        { role: 'selectAll', accelerator: 'CmdOrCtrl+A' },
      )
    } else if (params.selectionText !== undefined && params.selectionText !== '') {
      template.push(
        { role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { type: 'separator' },
        { role: 'selectAll', accelerator: 'CmdOrCtrl+A' },
      )
    }
    if (template.length === 0) return
    const menu = Menu.buildFromTemplate(template)
    const win = BrowserWindow.fromWebContents(contents) ?? undefined
    if (win !== undefined) menu.popup({ window: win })
    else menu.popup({})
  })
}
