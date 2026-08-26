# Gates: node-eng — 工程/文档分支集成

- [ ] T1: 子账复验（TG/T4/T5/T6）
  EVIDENCE: pending
- [ ] T2: check:guards 全链绿（含 biome 与 strict dead-export）
  CHECK: bash -lc 'pnpm run check:guards >/tmp/su-eng.log 2>&1 && echo ENG-GUARDS-OK'
  EXPECT: ENG-GUARDS-OK
  CWD: .
  EVIDENCE: pending
- [ ] T3: CI workflow 结构校验
  CHECK: bash -lc 'node scripts/guards/validate-ci-guards-step.mjs && echo ENG-CI-OK'
  EXPECT: ENG-CI-OK
  CWD: .
  EVIDENCE: pending
