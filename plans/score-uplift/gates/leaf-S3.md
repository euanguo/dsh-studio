# Gates: leaf-S3 — push 类路由服务端闸决策

OWNS: plugins/capabilities/src/routes/git.ts, tests/push-gate.test.ts, plans/score-uplift/notes/adr-push-gate.md

Scope: 二选一：(a) git.push/force-push 增加服务端 requirePushConfirmation 并配 tests/push-gate.test.ts；(b) ADR 论证同源围栏足够并修订 design 安全节一句。禁止不选。

- [x] G1: 决策产物在场（ADR 或实现二选一）
  CHECK: bash -lc 'test -f plans/score-uplift/notes/adr-push-gate.md && echo DECISION-ADR || (grep -q requirePushConfirmation plugins/capabilities/src/routes/git.ts && echo DECISION-IMPL)'
  EXPECT: /DECISION-(ADR|IMPL)/
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=DECISION-IMPL
- [x] G2: 若实现则配套测试绿；若 ADR 则标记 NA
  CHECK: bash -lc 'if [ -f plans/score-uplift/notes/adr-push-gate.md ]; then echo PUSH-GATE-NA; else node --test tests/push-gate.test.ts && echo PUSH-GATE-OK; fi'
  EXPECT: /PUSH-GATE-(NA|OK)/
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 106.146625 | PUSH-GATE-OK
