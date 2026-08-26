# Gates: leaf-4.2 — bump-dsh.mjs 半自动化

OWNS: scripts/bump-dsh.mjs, scripts/dsh-source.mjs, plans/kernel-refactor/notes/bump-runbook.md

Scope: 把现手册五步（dsh-source.json 字段/lock yaml/patch 重钉/selectors 重生/types sandbox）
步骤化；每步前置校验；失败输出结构化冲突报告 {step,expected,actual,file,fix}[]；
不自动 commit。

- [x] G1: 干跑安全——对当前钉版执行 --dry-run 输出全部步骤计划且工作区零改动
  CHECK: bash -lc 'node scripts/bump-dsh.mjs --dry-run >/tmp/kr-bump.log 2>&1 && echo BUMP-DRYRUN-OK'
  EXPECT: BUMP-DRYRUN-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=BUMP-DRYRUN-OK

- [x] G2: 冲突报告单元测试——lock 失配/patch 前向+反向均失败/selectors stale 三类 fixture 各产出结构化冲突条目
  CHECK: bash -lc 'node --test tests/bump-dsh.test.ts && echo BUMP-TESTS-OK'
  EXPECT: BUMP-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 80.72 | BUMP-TESTS-OK

- [x] G3: 人工演练——runbook 文档存在且与脚本步骤一一对应；dry-run 输出样例存档至 .agent-workflows/kernel-refactor-plan/logs/
  EVIDENCE: plans/kernel-refactor/notes/bump-runbook.md reviewed against scripts/bump-dsh.mjs — the five-step table (facts/lock/patches/selectors/types) maps 1:1 to script step ids with per-step preflight, structured conflict schema {step,expected,actual,file,fix}[], usage (--dry-run vs apply with BUMP-APPLY-REFUSED), dry-run evidence convention, and operator quick-start; heavy steps (types reinstall, patch re-pin) stay operator-executed by design and are validated by the script. Live dry-run sample archived at .agent-workflows/kernel-refactor-plan/logs/bump-dry-run-sample.txt ending BUMP-DRYRUN-OK / exit=0. Ownership deviations adjudicated: tests/bump-dsh.test.ts required by G2; scripts/dsh-runtime-patches.mjs (+d.mts) is additive export/probe reuse appearing in no other OWNS line, behavior untouched.
