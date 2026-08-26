# Gates: leaf-P2 — 目录拉取分页决策

OWNS: plugins/plugin-marketplace/src/host/github-source-adapter.ts, tests/catalog-paging.test.ts, plans/score-uplift/notes/adr-paging.md

Scope: 二选一：host 目录拉取分页/增量合并 + 配套 mock 测试；或 ADR 记录首开实测无可感知卡顿故延迟。禁止不选。

- [x] G1: 决策产物在场
  CHECK: bash -lc 'test -f plans/score-uplift/notes/adr-paging.md && echo PAGING-ADR || (node --test tests/catalog-paging.test.ts && echo PAGING-IMPL)'
  EXPECT: /PAGING-(ADR|IMPL)/
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=PAGING-ADR
