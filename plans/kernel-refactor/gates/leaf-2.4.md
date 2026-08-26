# Gates: leaf-2.4 — runtime 就绪协议加固

OWNS: src/runtime.ts, src/app-controller.ts, tests/runtime-handshake.test.ts, tests/runtime.test.ts

Scope: READY_LINE 降级为 URL 候选提供者 + HTTP 探测确认后才 ready；start 超时路径补
SIGTERM→SIGKILL 升级并 await exit；live/preview 共用 controller 防重入；不改上游打印格式、
不落盘新文件。

- [x] G1: 握手行为测试——假服务器：候选正确+HTTP 200 才 resolve；正则误匹配但 HTTP 拒绝 → fail-safe 继续等待至超时；超时路径验证 SIGTERM 后升级 SIGKILL 且 start() 等 exit 才返回
  CHECK: bash -lc 'node --test tests/runtime-handshake.test.ts && echo HANDSHAKE-TESTS-OK'
  EXPECT: HANDSHAKE-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 1494.277208 | HANDSHAKE-TESTS-OK

- [x] G2: supervisor 既有语义回归——stop() 升级链、exit 事件、runDshCommand 超时行为不变
  CHECK: bash -lc 'node --test tests/runtime*.test.ts && echo RUNTIME-REGRESS-OK'
  EXPECT: RUNTIME-REGRESS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 1517.958 | RUNTIME-REGRESS-OK

- [x] G3: 人工确认——handleRuntimeExit 已成为 controller 转移而非独立回调；live 与 preview 的防重入共用同一守卫入口（代码走查记录）
  EVIDENCE: `src/app-controller.ts` routes live restart, local-plugin install, and preview start through the same instance methods `beginSurfaceTransition()`/`endSurfaceTransition()`; `handleRuntimeExit` is handled as controller state transition and clears owned handles before failure/restart settlement, with no independent lifecycle callback or module-level runtime state. `tests/runtime-handshake.test.ts` and the existing lifecycle suite exercise the shared behavior. `tests/runtime.test.ts` was added to OWNS because its fake child must serve HTTP 200 for the new readiness contract; the change only adapts the fixture and leaves assertions unchanged.
