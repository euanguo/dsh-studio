# Gates: leaf-T4 — 主进程 chrome 测试

OWNS: tests/desktop-chrome.test.ts

Scope: stub MenuHost/IpcHost/WindowHost 测 createMenuModule 模板与通道映射、createIpcModule 注册面、normalizeWorkspacePaths 边界、windows 上下文开关再断言。

- [ ] G1: 新套件全绿
  CHECK: bash -lc 'node --test tests/desktop-chrome.test.ts && echo DESKTOP-CHROME-OK'
  EXPECT: DESKTOP-CHROME-OK
  CWD: .
  EVIDENCE: pending
- [ ] G2: 导出覆盖清单人工核对
  EVIDENCE: pending
