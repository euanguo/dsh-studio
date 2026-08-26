# Gates: leaf-2.2 — AppController 显式生命周期状态机

OWNS: src/app-controller.ts, src/main.ts, tests/desktop-lifecycle.test.ts

Scope: 按 target-design §4.1 建 AppController（idle→acquiring-lock→bootstrapping→
starting-runtime→ready⇄restarting + preview/updating/quitting 正交子态）；main.ts 全部
生命周期布尔与 runtime/preview 句柄全局收编为控制器状态；second-instance/activate/
before-quit/open-file 变为事件适配器。控制器纯可注入（ports），行为全测。

- [x] G1: 状态机行为测试——合法转移表全覆盖：restart 竞态（restarting 期间 second-instance/activate）、quit 中 runtime exit、install-on-quit 失败回 ready、queuedPaths 在 ready 进入时消费
  CHECK: bash -lc 'node --test tests/desktop-lifecycle.test.ts && echo LIFECYCLE-TESTS-OK'
  EXPECT: LIFECYCLE-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 75.47125 | LIFECYCLE-TESTS-OK

- [x] G2: 清零规格转绿——main.ts 无 transitioning/quitting/previewRuntime/queuedPaths 模块级残留
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-2.2-lifecycle.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ABSENT-OK

- [x] G3: 无兼容层自查——不存在旧函数名保留包装（resetLiveRuntime/startRuntime 若更名则旧名不得以别名存活）；转移表外无绕过状态的直接句柄突变；diff 抽查记录于本账
  EVIDENCE: legacy absence spec is green; old lifecycle function names are absent rather than aliased; `src/main.ts` forwards Electron events to controller methods and retains only Electron window registries/factory adapters; runtime, preview, queue, update, and quit state mutations are confined to `src/app-controller.ts`; no wrapper or re-export bridge remains.

- [x] G4: 人工映射完整性——调研 C 转移动作清单（bootstrap→…→quitting 七组）逐一指认到新 transition action 或显式删除理由
  EVIDENCE: bootstrap→acquiring-lock/bootstrapping via `markAcquiringLock`/`markBootstrapping`; startRuntime via `beginStartRuntime` and ready-entry queue consumption; stopLive/startLiveForMarketplace via restarting entry/exit actions; restartRuntime via `restart()` with restarting/starting-runtime re-entry guard; second-instance/activate/open-file/before-quit via controller adapters; install-on-quit via updating substate (failure returns ready and reopens update window, crash reaches failed-splash, success quits); runtime exit during quit/restart is ignored, otherwise failed-splash. Removed free lifecycle helpers have no compatibility alias.
