# Gates: leaf-S1 — 服务端 workspace scope 注册表

OWNS: plugins/capabilities/src/routes.ts, plugins/capabilities/src/routes/shared.ts, plugins/capabilities/src/routes/fs.ts, plugins/capabilities/src/workspace-scope.ts, tests/workspace-scope.test.ts, docs/design.md, docs/design.en.md

Scope: capabilities 新增 WorkspaceScopeRegistry（允许集 = session store 的 session cwd ∪ worktree 注册根，attach 快照 + 变更刷新）；routes 的 cwdOf/cwdScopeOf 先查注册表，未注册 cwd 返回 forbidden；fs.tree/read/tail 全部过 assertWithinSession；design 中英安全边界措辞改为与实现一致。

- [x] G1: scope 注册表单元行为——未注册拒绝/注册放行/穿越拒绝
  CHECK: bash -lc 'node --test tests/workspace-scope.test.ts && echo SCOPE-REGISTRY-OK'
  EXPECT: SCOPE-REGISTRY-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 70.937042 | SCOPE-REGISTRY-OK
- [x] G2: 路由回归不破线
  CHECK: bash -lc 'node --test tests/capabilities-wire-contract.test.ts tests/plugin-inventory.test.ts && echo SCOPE-ROUTES-OK'
  EXPECT: SCOPE-ROUTES-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 66.217958 | SCOPE-ROUTES-OK
- [x] G3: 文档措辞名实一致（人工）
  EVIDENCE: docs/design.md 安全边界 bullet 与 docs/design.en.md "Security boundaries" bullet rewritten in lockstep from "bound to the active Session and Workspace" to: cwd validated server-side by the workspace scope registry (registered workspace roots ∪ live session cwds; unregistered → `forbidden`), paths then fenced to the session subtree with reads anchored on the server-resolved repository root (subdirectory sessions keep working), and an explicit statement that the same-origin loopback fence is transport hygiene, not authentication.
