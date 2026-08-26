# Gates: leaf-T5 — 双语与审计收口

OWNS: docs/PLUGIN-DEVELOPMENT.md, docs/design.md, docs/design.en.md, docs/persistence-architecture.md, docs/persistence-architecture.en.md, docs/workbench-architecture.md, docs/workbench-architecture.en.md, docs/interaction-model.md, docs/interaction-model.en.md, AGENTS.md

Scope: 核心 Tier-EN-required 文档逐对同步（PLUGIN-DEVELOPMENT/persistence-architecture/workbench-architecture/design/interaction-model），其余文档按 AGENTS.md 声明为 zh-only；修复 interaction-model.en.md 损坏引用行；实现态 Workbench 文档必须明确四个 runtime services，StateSliceDefinition/persistVia 只是持久化词汇，不得写成 workbench.state service；补缺失 audit.md 骨架。

- [x] G1: 配对清点符合声明层级
  CHECK: node -e "const fs=require('fs');const need=['docs/PLUGIN-DEVELOPMENT.en.md','docs/persistence-architecture.en.md','docs/workbench-architecture.en.md'];if(!need.every(f=>fs.existsSync(f))){console.error('missing en');process.exit(1)}const t=fs.readFileSync('docs/interaction-model.en.md','utf8');if(/^#53203;/m.test(t)){console.error('corrupt ref');process.exit(1)}console.log('DOCS-PARITY-OK')"
  EXPECT: DOCS-PARITY-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=DOCS-PARITY-OK
- [x] G2: zh-only 层级规则修订人工审阅（AGENTS.md 措辞）
  EVIDENCE: AGENTS.md change rule now reads "Bilingual docs follow a two-tier policy. Tier-EN-required core docs — design*, usage*, PLUGIN-DEVELOPMENT*, persistence-architecture*, workbench-architecture*, interaction-model* — must keep zh/en pairs in sync when changed. All other docs are the zh-only tier (EN counterparts optional; zh is authoritative). State the tier when adding a new doc." Semantic review after M3's CUT decision updated both design documents and both workbench-architecture documents to describe four runtime services (SurfaceRegistry/OpenPipeline/LayoutService/WorkspaceEvents); StateSliceDefinition/persistVia is explicitly non-service vocabulary, and the historical proposal route is labeled as such. The required EN docs exist and interaction-model.en.md corrupted reference is gone; T5 artifact set plus driver corrections now matches the tier policy.
