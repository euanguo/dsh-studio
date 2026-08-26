# Gates: node-4 — platform-engineering 分支集成

Scope: leaf-4.1…4.3 全部 VERIFIED 后：依赖五清单单一源对拍成立，bump 半自动可用，
上游提案包成稿。

- [x] N4.0: 分支子账全部复验（--reverify 三叶）
  EVIDENCE: gate-check --approve --reverify over leaf-4.1 (reran 4), leaf-4.2 (reran 2 earlier this wave), leaf-4.3 → all three ALL MET, 0 failures.
- [x] N4.1: 依赖事实测试 + 新 guard 通过
  CHECK: bash -lc 'node --test tests/dsh-dependencies.test.ts >/tmp/kr-n4.log 2>&1 && node scripts/guards/guard-dsh-dependencies.mjs && echo DEPS-OK'
  EXPECT: DEPS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=GUARD-OK | DEPS-OK
- [x] N4.2: 集成门禁（typecheck+build:dsh+build）
  CHECK: bash -lc 'pnpm run typecheck >/dev/null 2>&1 && pnpm run build:dsh >/tmp/kr-n4b.log 2>&1 && pnpm run build >/dev/null 2>&1 && echo PLATFORM-INTEGRATION-OK'
  EXPECT: PLATFORM-INTEGRATION-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=PLATFORM-INTEGRATION-OK
- [x] N4.3: bump 干跑——对当前版本执行 bump-dsh.mjs --dry-run，输出步骤计划且零改动；冲突报告格式样例存档至 .agent-workflows/kernel-refactor-plan/logs/
  EVIDENCE: fresh `node scripts/bump-dsh.mjs --dry-run` on pin 0.1.1-rc.2 → exit=0, full five-step plan printed, ends BUMP-DRYRUN-OK (log /tmp/kr-bump-n43.log); archived sample at .agent-workflows/kernel-refactor-plan/logs/bump-dry-run-sample.txt; zero-mutation proven by the worker's before/after porcelain diff (WORKTREE-UNCHANGED) and conflict-report shape documented in plans/kernel-refactor/notes/bump-runbook.md.
- [x] N4.4: Surface staging/web/packed smoke——staged runtime serves the Web profile and the packed desktop artifact mounts without plugin-load errors
  CHECK: bash -lc 'unset ELECTRON_RUN_AS_NODE; pnpm run stage:dsh >/tmp/kr-n4-stage.log 2>&1 && pnpm run smoke:web >/tmp/kr-n4-web.log 2>&1 && pnpm run smoke:pack >/tmp/kr-n4-pack.log 2>&1 && echo SURFACE-SMOKES-OK'
  EXPECT: SURFACE-SMOKES-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=SURFACE-SMOKES-OK
