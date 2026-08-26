# Gates: leaf-1.3 — SurfaceRegistry 三轨归一

OWNS: plugins/shared/contracts/workbench-contracts.ts, plugins/sidebar/src/client/contract.ts, plugins/sidebar/src/client/sidebar-service.ts, plugins/sidebar/src/client/builtins/**, plugins/sidebar/src/client/surfaces/types.ts, plugins/sidebar/src/client/file-view-host.tsx, plugins/sidebar/src/client.ts, plugins/sidebar/src/client/side-tools-menu.tsx, plugins/sidebar/src/client/side-tool-row.tsx, plugins/sidebar/src/client/side-tool-helpers.tsx, plugins/sidebar/src/client/SideToolsPanel.tsx, plugins/sidebar/src/client/bottom-workbench.tsx, plugins/sidebar/src/client/settings-feature-card.tsx, plugins/sidebar/src/client/settings.tsx, plugins/sidebar/src/client/plugin.tsx, plugins/sidebar/src/client/open/pipeline.ts, plugins/sidebar-desktop/src/client/plugin.tsx, plugins/workbench/src/registry.ts, tests/surface-registry.test.ts, tests/sidebar.test.ts, tests/layout-scope.test.ts, tests/open-pipeline-cutover.test.ts, tests/workbench-kernel.test.ts

Scope: SidebarTabDescriptor/SidebarViewerDescriptor/registerSurfaceRenderer 三套注册并入
kernel registry 单表 descriptor{kind,rail?,center?,viewer?,scopeNeed,previewable,
focusPolicy}；右栏 chip、中央 tab、viewer 选择、外链 claim 全部由同一张表驱动；
sidebar.register 是唯一注册事件并投影到 workbench.registry；open pipeline 不再维护静态
第二份 descriptor 表；viewer-only descriptors 合法；旧三 API 与 CenterSurfaceKind 本地重声明删除。

- [x] G1: registry 驱动行为测试——同一注册事件投影到 kernel 并同时驱动 rail chip、center 打开、file viewer 匹配；available/order/single/settings 字段语义保持
  CHECK: bash -lc 'node --test tests/surface-registry.test.ts tests/sidebar.test.ts tests/layout-scope.test.ts tests/open-pipeline-cutover.test.ts tests/workbench-kernel.test.ts && echo REGISTRY-TESTS-OK'
  EXPECT: REGISTRY-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 148.30825 | REGISTRY-TESTS-OK

- [x] G2: 清零规格转绿——三注册 API 与本地 kind 重声明清零
  CHECK: bash -lc 'for s in leaf-1.3-registry leaf-1.3-types; do node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/$s.json || exit 1; done && echo REGISTRY-ABSENT-OK'
  EXPECT: REGISTRY-ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ABSENT-OK | REGISTRY-ABSENT-OK

- [x] G3: 字段奇偶人工核对——旧三轨字段逐一归档去向（吸收/删除/更名），无字段信息丢失；设置页开关功能不回归（DEV 实机点验）
  EVIDENCE: Field mapping is recorded in `.agent-workflows/kernel-refactor-leaf-1-3/audit.md`: rail fields map to `descriptor.rail`, viewer fields to `descriptor.viewer`, renderer registration to `descriptor.center`, `id` to `kind`, and `requiresWorkspace` to `scopeNeed`; no legacy field is dropped. DEV session `dsh-dev-w5` showed the registry-driven Sidebar settings region and its tool switches; the Review switch was toggled off then restored on, and the feature settings popup opened and closed successfully. Evidence screenshot: `tmp/desktop-verify/w5/sidebar-settings.png`; final smoke passed 3/3 with `errors` and `console` empty.
