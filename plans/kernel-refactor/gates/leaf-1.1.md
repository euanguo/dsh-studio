# Gates: leaf-1.1 — workbench 插件骨架 + 五服务契约

OWNS: plugins/workbench/**, plugins/shared/contracts/workbench-contracts.ts, cordis.patch.yml, src/profile.ts, package.json, scripts/build.mjs, tests/workbench-kernel.test.ts

Scope: 新增纯 cordis 服务插件 @dsh-studio/workbench：SurfaceRegistry/OpenPipeline(核心)/
LayoutService/ScopeService+StateStore/WorkspaceEvents 五服务按 PLAN 命名约定挂 ctx；
扩展 shared/workbench-contracts 类型（LayoutRegion/StateSlice/事件载荷）；经 4.1 生成器
注册进 inject/cordis insert/profile/build 清单。本叶不带消费方（后续叶直迁），但每个
服务必须有单元行为背书，禁止空壳导出。

- [ ] G1: 五服务行为测试——registry 注册/解析/dedupe；open 纯决策路由到 plan；layout claim/release/preview 协商与 z-index 表裁决；state slice set/get/version 迁移钩子；events 两类发布订阅
  CHECK: bash -lc 'node --test tests/workbench-kernel.test.ts && echo KERNEL-SKELETON-TESTS-OK'
  EXPECT: KERNEL-SKELETON-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: 注册一致性——依赖事实源已含 workbench 且 guard 对拍全绿（inject/cordis insert/BUNDLED_*/build 表四处一致）
  CHECK: bash -lc 'node scripts/sync-dsh-dependencies.mjs --check && node scripts/guards/guard-dsh-dependencies.mjs && echo WORKBENCH-REGISTERED-OK'
  EXPECT: WORKBENCH-REGISTERED-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 边界自查——跨插件零值导入（服务只经 ctx id 暴露）；无 DOM/React 泄入 contracts；新类型全部进 shared/workbench-contracts 而非散落
  EVIDENCE: pending
