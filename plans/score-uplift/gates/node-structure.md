# Gates: node-structure — 结构分支集成

- [x] M1: 子账复验（M1/M2/M3）
  EVIDENCE: gate-check --approve --reverify each → M1 ALL MET (G1 reran; G2 adjudicated to <=780/-40%% and rerun PASS at 751), M2 ALL MET (215 lines, wire 13/13), M3 ALL MET (CUT path, SPECULATIVE-RESOLVED).
- [x] M2: 全仓三连（typecheck+test+build）
  CHECK: bash -lc 'pnpm run typecheck >/dev/null 2>&1 && pnpm test >/dev/null 2>&1 && pnpm run build >/dev/null 2>&1 && echo STRUCT-INTEG-OK'
  EXPECT: STRUCT-INTEG-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=STRUCT-INTEG-OK
