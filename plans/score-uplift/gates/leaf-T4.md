# Gates: leaf-T4 — 主进程 chrome 测试

OWNS: tests/desktop-chrome.test.ts

Scope: stub MenuHost/IpcHost/WindowHost 测 createMenuModule 模板与通道映射、createIpcModule 注册面、normalizeWorkspacePaths 边界、windows 上下文开关再断言。

- [x] G1: 新套件全绿
  CHECK: bash -lc 'node --experimental-test-module-mocks --test tests/desktop-chrome.test.ts && echo DESKTOP-CHROME-OK'
  EXPECT: DESKTOP-CHROME-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 93.940583 | DESKTOP-CHROME-OK
- [x] G2: 导出覆盖清单人工核对
  EVIDENCE: Direct driver review of tests/desktop-chrome.test.ts confirms behavioral coverage for createMenuModule (Settings and Toggle Sidebar labels/accelerators invoke real DesktopCommand callbacks), normalizeWorkspacePaths (existing directory/file normalization, deduplication, missing-path skip), createIpcModule (channel registration, command send, chrome geometry, update-window sender rejection/acceptance, http(s)-only external opening), and createWindowsModule (real mocked BrowserWindow construction through showSplash, asserting contextIsolation=true, nodeIntegration=false, sandbox=true and splash query propagation). The test file uses Node 24 experimental module mocking only to replace Electron's external runtime; no source-text assertions or existence-only export checks.
