# Gates: leaf-4.2 — bump-dsh.mjs 半自动化

OWNS: scripts/bump-dsh.mjs, scripts/dsh-source.mjs, plans/kernel-refactor/notes/bump-runbook.md

Scope: 把现手册五步（dsh-source.json 字段/lock yaml/patch 重钉/selectors 重生/types sandbox）
步骤化；每步前置校验；失败输出结构化冲突报告 {step,expected,actual,file,fix}[]；
不自动 commit。

- [ ] G1: 干跑安全——对当前钉版执行 --dry-run 输出全部步骤计划且工作区零改动
  CHECK: bash -lc 'node scripts/bump-dsh.mjs --dry-run >/tmp/kr-bump.log 2>&1 && echo BUMP-DRYRUN-OK'
  EXPECT: BUMP-DRYRUN-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: 冲突报告单元测试——lock 失配/patch 前向+反向均失败/selectors stale 三类 fixture 各产出结构化冲突条目
  CHECK: bash -lc 'node --test tests/bump-dsh.test.ts && echo BUMP-TESTS-OK'
  EXPECT: BUMP-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 人工演练——runbook 文档存在且与脚本步骤一一对应；dry-run 输出样例存档至 .agent-workflows/kernel-refactor-plan/logs/
  EVIDENCE: pending
