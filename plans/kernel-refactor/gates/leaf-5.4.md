# Gates: leaf-5.4 — 双语文档同步

OWNS: docs/**, AGENTS.md, plugins/AGENTS.md

Scope: design.md/design.en.md 数据流与内核章节改写为实现态（五服务/生命周期状态机/相位机/
依赖事实源）；workbench-architecture.md 状态翻转为已实现并附偏差记录；plugins/AGENTS.md
增补 LayoutService/overlay 挂载/探针模块新规则；双语逐节对照。

- [ ] G1: 内核章节双语在场——两份 design 文档均含五服务小节
  CHECK: bash -lc 'grep -q "OpenPipeline" docs/design.md && grep -q "OpenPipeline" docs/design.en.md && grep -q "SurfaceRegistry" docs/design.md && grep -q "SurfaceRegistry" docs/design.en.md && echo DOCS-KERNEL-SYNC-OK'
  EXPECT: DOCS-KERNEL-SYNC-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: 提案状态翻转在场——workbench-architecture.md 双语状态行更新
  CHECK: bash -lc 'grep -qE "已实现|implemented" docs/workbench-architecture.md && echo STATUS-FLIPPED-OK'
  EXPECT: STATUS-FLIPPED-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 语义对照人工审阅——中英文档逐节语义一致（非逐词）；AGENTS/plugins/AGENTS 变更经第二人复核签名
  EVIDENCE: pending
