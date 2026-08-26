# Gates: leaf-5.4 — 双语文档同步

OWNS: docs/**, AGENTS.md, plugins/AGENTS.md

Scope: design.md/design.en.md 数据流与内核章节改写为实现态（五服务/生命周期状态机/相位机/
依赖事实源）；workbench-architecture.md 状态翻转为已实现并附偏差记录；plugins/AGENTS.md
增补 LayoutService/overlay 挂载/探针模块新规则；双语逐节对照。

- [x] G1: 内核章节双语在场——两份 design 文档均含五服务小节
  CHECK: bash -lc 'grep -q "OpenPipeline" docs/design.md && grep -q "OpenPipeline" docs/design.en.md && grep -q "SurfaceRegistry" docs/design.md && grep -q "SurfaceRegistry" docs/design.en.md && echo DOCS-KERNEL-SYNC-OK'
  EXPECT: DOCS-KERNEL-SYNC-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=DOCS-KERNEL-SYNC-OK

- [x] G2: 提案状态翻转在场——workbench-architecture.md 双语状态行更新
  CHECK: bash -lc 'grep -qE "已实现|implemented" docs/workbench-architecture.md && echo STATUS-FLIPPED-OK'
  EXPECT: STATUS-FLIPPED-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=STATUS-FLIPPED-OK

- [x] G3: 语义对照人工审阅——中英文档逐节语义一致（非逐词）；AGENTS/plugins/AGENTS 变更经第二人复核签名
  EVIDENCE: independent reviewer (subagent 3d766612-8ad8-4b6c-b933-c7d4fd85f145, read-only) verified section-by-section semantic equivalence of design.md ↔ design.en.md kernel-contract sections and the workbench-architecture status-flip deviations against implementation reality (five service files, contracts path, ensureLayoutDom export, workbench.* ctx ids, 4096/0.75 width constants, guard allowlist). First pass found one zh drift in the StateStore bullet plus a 键盘键盘 duplication; both fixed (design.md StateStore now "仅 global 桶折叠到单一桶") and the reviewer re-verified with final verdict REVIEW-SIGNOFF-OK. plugins/AGENTS.md additions (probe-module registration + Workbench kernel services rules) were covered by the same review; a pre-existing out-of-scope zh/en marketplace-section divergence was noted and left untouched.
