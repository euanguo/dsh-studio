# Gates: leaf-1.3 — SurfaceRegistry 三轨归一

OWNS: plugins/shared/contracts/workbench-contracts.ts, plugins/sidebar/src/client/contract.ts, plugins/sidebar/src/client/sidebar-service.ts, plugins/sidebar/src/client/builtins/**, plugins/sidebar/src/client/surfaces/types.ts, plugins/sidebar/src/client/file-view-host.tsx, tests/surface-registry.test.ts

Scope: SidebarTabDescriptor/SidebarViewerDescriptor/registerSurfaceRenderer 三套注册并入
kernel registry 单表 descriptor{kind,rail?,center?,viewer?,scopeNeed,previewable,
focusPolicy}；右栏 chip、中央 tab、viewer 选择、外链 claim 全部由同一张表驱动；
旧三 API 与 CenterSurfaceKind 本地重声明删除。

- [ ] G1: registry 驱动行为测试——同一 descriptor 同时驱动 rail chip 渲染、center 打开、file viewer 匹配；available/order/single/settings 字段语义保持
  CHECK: bash -lc 'node --test tests/surface-registry.test.ts && echo REGISTRY-TESTS-OK'
  EXPECT: REGISTRY-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: 清零规格转绿——三注册 API 与本地 kind 重声明清零
  CHECK: bash -lc 'for s in leaf-1.3-registry leaf-1.3-types; do node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/$s.json || exit 1; done && echo REGISTRY-ABSENT-OK'
  EXPECT: REGISTRY-ABSENT-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 字段奇偶人工核对——旧三轨字段逐一归档去向（吸收/删除/更名），无字段信息丢失；设置页开关功能不回归（DEV 实机点验）
  EVIDENCE: pending
