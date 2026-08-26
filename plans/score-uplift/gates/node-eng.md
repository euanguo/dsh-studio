# Gates: node-eng — 工程/文档分支集成

- [x] T1: 子账复验（TG/T4/T5/T6）
  EVIDENCE: parent independently reverified leaf-TG (3 runnable gates rerun, G4 manual already negative-controlled), leaf-T4 (desktop-chrome test rerun), leaf-T5 (docs parity rerun after four-service corrections), and leaf-T6 (nightly YAML decision rerun); all four report ALL MET.
- [x] T2: check:guards 全链绿（含 biome 与 strict dead-export）
  CHECK: bash -lc 'pnpm run check:guards >/tmp/su-eng.log 2>&1 && echo ENG-GUARDS-OK'
  EXPECT: ENG-GUARDS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ENG-GUARDS-OK
- [x] T3: CI workflow 结构校验
  CHECK: bash -lc 'node scripts/guards/validate-ci-guards-step.mjs && echo ENG-CI-OK'
  EXPECT: ENG-CI-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=CI-GUARDS-STEP-OK | ENG-CI-OK
