# Gates: leaf-1.6 — LayoutService 区域树收口

OWNS: plugins/workbench/src/layout.ts, plugins/shared/layout-dom.ts, plugins/panel-controls/src/client.ts, plugins/panel-controls/src/index.ts, plugins/panel-controls/src/style.d.ts, plugins/panel-controls/src/terminal/plugin.tsx, plugins/pinned-summary/src/**, plugins/sidebar/src/client/{plugin.tsx,SideToolsPanel.tsx,side-tabs.tsx,side-tools-menu.tsx,builtins/deps.ts,workspace-tools.tsx}, plugins/sidebar/src/client/side-tools.module.css, plugins/plugin-marketplace/src/client/marketplace-view.tsx, plugins/sidebar/src/client/surfaces/center-surface-host.tsx, tests/layout-service.test.ts, tests/right-panel-layout.test.ts

Scope: 五区模型（top-rail/left-rail/right-panel/center-tabs/overlay）+声明式 z-index 表；
claimRightPanel 协调器及其三个 #root padding 写手全部改为 layout.claim/release/preview；
html dataset/CSS 变量旗标单点化；pinned-summary style/aside 与 marketplace root 改经
overlay 区挂载协议。保留 `674392f` 的 sidebar domain width policy：persisted 4096 上限与
live viewport 75% cap 不迁入 LayoutService；LayoutService 只接收最终宽度并持久化/协商 footprint。

- [x] G1: 布局协商行为测试——claim 互斥最近者胜、release 归零、preview 拖拽热路径帧序、区域宿主挂载/卸载顺序、z-index 表权威裁决
  CHECK: bash -lc 'node --test tests/layout-service.test.ts && echo LAYOUT-TESTS-OK'
  EXPECT: LAYOUT-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 77.989833 | LAYOUT-TESTS-OK

- [x] G2: 清零规格转绿——消费方插件中协调器三符号/#root 写手/ownership 旗标清零
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-1.6-layout.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ABSENT-OK

- [x] G3: 既有布局相关测试回归——包括 recent sidebar width policy（persisted bound/live viewport cap）
  CHECK: bash -lc 'node --test tests/layout-scope.test.ts tests/sidebar.test.ts tests/center-surface-store.test.ts tests/right-panel-layout.test.ts && echo LAYOUT-REGRESS-OK'
  EXPECT: LAYOUT-REGRESS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 133.342167 | LAYOUT-REGRESS-OK

- [x] G4: DEV 实机拖拽验证——sidebar 拖宽、pinned-summary 开合、marketplace 弹层三者并发操作无跳动/遮挡回归（dsh-desktop-verify 留证）
  EVIDENCE: DEV `dsh-desktop-verify` on the clean staged runtime; absolute evidence in `tmp/desktop-verify/w6/screenshots/01-en-home.png` through `16-zh-marketplace-sidebar-concurrent.png`. The actual `.ohlr-YhpO3W-dsh-studio-workspace-resize` handle committed 320→480→320px, with `dshStudioRightPanelWidth` and `#dsh-studio-sidebar-root` geometry tracking each state. Pinned Summary was observed open, closed through its labeled control, and confirmed hidden afterward; marketplace stayed open concurrently with the sidebar and center terminal. `errors`/`console` were empty.

- [x] G5: 无兼容层自查——panel-controls 中旧协调器不得以 deprecated 包装存活；overlay 挂载协议是唯一 body 级入口（body append 直调清零）
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-1.6-body-mount.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ABSENT-OK
