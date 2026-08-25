# Gates: node-5 — hygiene-docs 分支集成

Scope: leaf-5.1…5.4 全部 VERIFIED 后：残留清零、guards 接线、双语文档同步。

- [ ] N5.0: 分支子账全部复验（--reverify 四叶）
  EVIDENCE: pending
- [ ] N5.1: 残留清零规格转绿
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-5.2-residue.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: pending
- [ ] N5.2: guards 扩展后 check:guards 全绿
  CHECK: bash -lc 'pnpm run check:guards >/tmp/kr-n5.log 2>&1 && echo HYGIENE-GUARDS-OK'
  EXPECT: HYGIENE-GUARDS-OK
  CWD: .
  EVIDENCE: pending
- [ ] N5.3: 双语对照人工审阅——design.md/design.en.md 内核章节语义一致；plugins/AGENTS.md 新规则双语一致（本仓文档均为英/中分文件时逐对核对）；workbench-architecture.md 状态翻转含偏差记录
  EVIDENCE: pending
