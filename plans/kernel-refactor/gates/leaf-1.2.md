# Gates: leaf-1.2 — OpenPipeline 全入口收口

OWNS: plugins/sidebar/src/client/open/**, plugins/sidebar/src/client/intercept.ts, plugins/sidebar/src/client/plugin.tsx, plugins/sidebar/src/client/surfaces/center-surface-add-menu.tsx, plugins/sidebar/src/client/files/files-view.tsx, plugins/sidebar/src/client/files/files-search.tsx, plugins/sidebar/src/client/source-control/source-control-panel.tsx, plugins/sidebar/src/client/workspace-panel-loading.ts, plugins/sidebar/src/client/side-tabs.tsx, plugins/plugin-marketplace/src/client/marketplace-view.tsx, plugins/plugin-marketplace/src/client/use-marketplace.ts, tests/open-pipeline-cutover.test.ts

Scope: 调研 A 表1 的 13 类打开入口全部改走 pipeline.open({kind,target,intent})；
openPath 劫持机制收编为 pipeline 内唯一 installOfficialOpenHook（refcount/HMR 幂等）；
外链 claim 并入 linkHandler 表；删除 openFileSurface/openDiff*/openCommit* 散装签名、
side-tabs 手工查重、"+"菜单直调分支、marketplace body-append 旁路。preview 布尔不出
pipeline 边界。当前 baseline 已包含 GitWatch websocket 与断线 fallback；本叶修改
workspace-panel-loading.ts 时只迁打开调用点，必须保留 git-watch 订阅/回退逻辑与 root
refresh 修复（`af143f1`），以及 official wrapper Input 的 wrapper-level Files CSS
修复（`d96dac5`）。

- [x] G1: 入口覆盖行为测试——13 类入口逐条映射断言（含左栏 open-directory 的 intent 语义、双击 pin/单击 preview、dedupeKey 查重、background 不激活）
  CHECK: bash -lc 'node --test tests/open-pipeline-cutover.test.ts && echo PIPELINE-TESTS-OK'
  EXPECT: PIPELINE-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 93.391292 | PIPELINE-TESTS-OK

- [x] G2: 清零规格转绿——消费方插件中劫持三符号清零
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-1.2-open-pipeline.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ABSENT-OK

- [x] G3: 相邻行为回归——center-surface、layout scope、git freshness、source-control retention 与 root directory refresh 既有测试绿
  CHECK: bash -lc 'node --test tests/center-surface-store.test.ts tests/layout-scope.test.ts tests/git-watch.test.ts tests/sidebar-runtimes.test.ts && echo PIPELINE-REGRESS-OK'
  EXPECT: PIPELINE-REGRESS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 133.698959 | PIPELINE-REGRESS-OK

- [x] G4: HMR 双安装安全——installOfficialOpenHook 连续两次 install 后 restore 行为等价单次（G1 内 fixture）+ DEV 实机热更一轮无重复弹层（记录于本账）
  EVIDENCE: `tests/open-pipeline-cutover.test.ts` includes the double-install/restore fixture and passes in G1 (15/15); DEV desktop was cleanly restarted, the final runtime loaded all plugins, one client hot-reload round was exercised, and post-HMR DOM evidence showed 4 center tabs, 0 dialogs, and 3 expected roots; smoke suite passed 3/3 after HMR with `errors` and `console` empty. Evidence: `tmp/desktop-verify/w3/screenshots-00-before-hmr.png`, `tmp/desktop-verify/w3/screenshots-01-after-hmr.png`.

- [x] G5: 无兼容层自查——被删六个散装签名在仓内无 re-export/别名残骸；调用方 diff 全部直指 pipeline.open
  EVIDENCE: consumer scan is clean for `openFileSurface`, `openDiffSurface`, `openDiffAllSurface`, `openConflictSurface`, `openCommitSurface`, `openCommitFileSurface`, `openCommittedSurface`, `acquireOpenPathPatch`, `registerOpenPathHandler`, and `registerLinkInterception` (only the absence-oracle self-test mentions its planted symbol); all migrated call sites use `workbenchOpen().open(...)`; no re-export or alias bridge remains.
