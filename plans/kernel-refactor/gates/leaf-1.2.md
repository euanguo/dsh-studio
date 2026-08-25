# Gates: leaf-1.2 — OpenPipeline 全入口收口

OWNS: plugins/sidebar/src/client/open/**, plugins/sidebar/src/client/intercept.ts, plugins/sidebar/src/client/plugin.tsx, plugins/sidebar/src/client/surfaces/center-surface-add-menu.tsx, plugins/sidebar/src/client/files/files-view.tsx, plugins/sidebar/src/client/files/files-search.tsx, plugins/sidebar/src/client/source-control/source-control-panel.tsx, plugins/sidebar/src/client/workspace-panel-loading.ts, plugins/sidebar/src/client/side-tabs.tsx, plugins/plugin-marketplace/src/client/marketplace-view.tsx, plugins/plugin-marketplace/src/client/use-marketplace.ts, tests/open-pipeline-cutover.test.ts

Scope: 调研 A 表1 的 13 类打开入口全部改走 pipeline.open({kind,target,intent})；
openPath 劫持机制收编为 pipeline 内唯一 installOfficialOpenHook（refcount/HMR 幂等）；
外链 claim 并入 linkHandler 表；删除 openFileSurface/openDiff*/openCommit* 散装签名、
side-tabs 手工查重、"+"菜单直调分支、marketplace body-append 旁路。preview 布尔不出
pipeline 边界。

- [ ] G1: 入口覆盖行为测试——13 类入口逐条映射断言（含左栏 open-directory 的 intent 语义、双击 pin/单击 preview、dedupeKey 查重、background 不激活）
  CHECK: bash -lc 'node --test tests/open-pipeline-cutover.test.ts && echo PIPELINE-TESTS-OK'
  EXPECT: PIPELINE-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: 清零规格转绿——消费方插件中劫持三符号清零
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-1.2-open-pipeline.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 相邻行为回归——center-surface store 与 layout-scope 既有测试绿
  CHECK: bash -lc 'node --test tests/center-surface-store.test.ts tests/layout-scope.test.ts && echo PIPELINE-REGRESS-OK'
  EXPECT: PIPELINE-REGRESS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G4: HMR 双安装安全——installOfficialOpenHook 连续两次 install 后 restore 行为等价单次（G1 内 fixture）+ DEV 实机热更一轮无重复弹层（记录于本账）
  EVIDENCE: pending

- [ ] G5: 无兼容层自查——被删六个散装签名在仓内无 re-export/别名残骸；调用方 diff 全部直指 pipeline.open
  EVIDENCE: pending
