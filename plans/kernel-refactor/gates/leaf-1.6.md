# Gates: leaf-1.6 — LayoutService 区域树收口

OWNS: plugins/workbench/src/client/layout/**, plugins/panel-controls/src/**, plugins/pinned-summary/src/**, plugins/sidebar/src/client/workspace-tools.tsx, plugins/sidebar/src/client/side-tools.module.css, plugins/plugin-marketplace/src/client/marketplace-view.tsx, plugins/sidebar/src/client/surfaces/center-surface-host.tsx, tests/layout-service.test.ts

Scope: 五区模型（top-rail/left-rail/right-panel/center-tabs/overlay）+声明式 z-index 表；
claimRightPanel 协调器及其三个 #root padding 写手全部改为 layout.claim/release/preview；
html dataset/CSS 变量旗标单点化；pinned-summary style/aside 与 marketplace root 改经
overlay 区挂载协议；宽度记忆与 rail cap 迁入并由 StateStore 持久化。

- [ ] G1: 布局协商行为测试——claim 互斥最近者胜、release 归零、preview 拖拽热路径帧序、区域宿主挂载/卸载顺序、z-index 表权威裁决
  CHECK: bash -lc 'node --test tests/layout-service.test.ts && echo LAYOUT-TESTS-OK'
  EXPECT: LAYOUT-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: 清零规格转绿——消费方插件中协调器三符号/#root 写手/ownership 旗标清零
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-1.6-layout.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 既有布局相关测试回归
  CHECK: bash -lc 'node --test tests/layout-scope.test.ts tests/center-surface-store.test.ts && echo LAYOUT-REGRESS-OK'
  EXPECT: LAYOUT-REGRESS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G4: DEV 实机拖拽验证——sidebar 拖宽、pinned-summary 开合、marketplace 弹层三者并发操作无跳动/遮挡回归（dsh-desktop-verify 留证）
  EVIDENCE: pending

- [ ] G5: 无兼容层自查——panel-controls 中旧协调器不得以 deprecated 包装存活；overlay 挂载协议是唯一 body 级入口（body append 直调清零）
  EVIDENCE: pending
