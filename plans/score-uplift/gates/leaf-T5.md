# Gates: leaf-T5 — 双语与审计收口

OWNS: docs/PLUGIN-DEVELOPMENT.md, docs/design.en.md, docs/persistence-architecture.en.md, docs/workbench-architecture.en.md, docs/interaction-model.en.md, AGENTS.md

Scope: 默认策略——核心三篇补 EN（PLUGIN-DEVELOPMENT/persistence-architecture/workbench-architecture），其余声明 zh-only 层级并修订 AGENTS.md 双语规则措辞；修复 interaction-model.en.md 损坏引用行；补缺失 audit.md 骨架。design.md/design.en.md 归 leaf-S1 所有，本叶不得触碰。

- [ ] G1: 配对清点符合声明层级
  CHECK: node -e "const fs=require('fs');const need=['docs/PLUGIN-DEVELOPMENT.en.md','docs/persistence-architecture.en.md','docs/workbench-architecture.en.md'];if(!need.every(f=>fs.existsSync(f))){console.error('missing en');process.exit(1)}const t=fs.readFileSync('docs/interaction-model.en.md','utf8');if(/#53203;/.test(t)){console.error('corrupt ref');process.exit(1)}console.log('DOCS-PARITY-OK')"
  EXPECT: DOCS-PARITY-OK
  CWD: .
  EVIDENCE: pending
- [ ] G2: zh-only 层级规则修订人工审阅（AGENTS.md 措辞）
  EVIDENCE: pending
