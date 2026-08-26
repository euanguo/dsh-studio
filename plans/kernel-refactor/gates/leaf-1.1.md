# Gates: leaf-1.1 — workbench 插件骨架 + 五服务契约

OWNS: plugins/workbench/**, plugins/shared/contracts/workbench-contracts.ts, config/dsh-dependencies.json, cordis.patch.yml, src/profile.ts, package.json, scripts/build.mjs, scripts/stage-dsh.mjs, tests/workbench-kernel.test.ts

Scope: 新增纯 cordis 服务插件 @dsh-studio/workbench：SurfaceRegistry/OpenPipeline(核心)/
LayoutService/ScopeService+StateStore/WorkspaceEvents 五服务按 PLAN 命名约定挂 ctx；
扩展 shared/workbench-contracts 类型（LayoutRegion/StateSlice/事件载荷）；经 4.1 生成器
注册进 inject/cordis insert/profile/build 清单。本叶不带消费方（后续叶直迁），但每个
服务必须有单元行为背书，禁止空壳导出。

- [x] G1: 五服务行为测试——registry 注册/解析/dedupe；open 纯决策路由到 plan；layout claim/release/preview 协商与 z-index 表裁决；state slice set/get/version 迁移钩子；events 两类发布订阅
  CHECK: bash -lc 'node --test tests/workbench-kernel.test.ts && echo KERNEL-SKELETON-TESTS-OK'
  EXPECT: KERNEL-SKELETON-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 92.680667 | KERNEL-SKELETON-TESTS-OK

- [x] G2: 注册一致性——依赖事实源已含 workbench 且 guard 对拍全绿（inject/cordis insert/BUNDLED_*/build 表四处一致）
  CHECK: bash -lc 'node scripts/sync-dsh-dependencies.mjs --check && node scripts/guards/guard-dsh-dependencies.mjs && echo WORKBENCH-REGISTERED-OK'
  EXPECT: WORKBENCH-REGISTERED-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=GUARD-OK | WORKBENCH-REGISTERED-OK

- [x] G3: 边界自查——跨插件零值导入（服务只经 ctx id 暴露）；无 DOM/React 泄入 contracts；新类型全部进 shared/workbench-contracts 而非散落
  EVIDENCE: `tests/workbench-kernel.test.ts` import-direction behavior test passed; `plugins/workbench/src/**` imports only local kernel modules; `plugins/shared/contracts/workbench-contracts.ts` has no DOM/React/cordis runtime imports; all five services are exposed through ctx ids in `src/client.ts`.

- [x] G4: Staging inventory includes every browser plugin bundled by the desktop profile, including workbench
  CHECK: node --test tests/plugin-inventory.test.ts
  EXPECT: /fail 0/
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ todo 0 | ℹ duration_ms 72.827958
