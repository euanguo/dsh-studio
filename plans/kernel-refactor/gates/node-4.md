# Gates: node-4 — platform-engineering 分支集成

Scope: leaf-4.1…4.3 全部 VERIFIED 后：依赖五清单单一源对拍成立，bump 半自动可用，
上游提案包成稿。

- [ ] N4.0: 分支子账全部复验（--reverify 三叶）
  EVIDENCE: pending
- [ ] N4.1: 依赖事实测试 + 新 guard 通过
  CHECK: bash -lc 'node --test tests/dsh-dependencies.test.ts >/tmp/kr-n4.log 2>&1 && node scripts/guards/guard-dsh-dependencies.mjs && echo DEPS-OK'
  EXPECT: DEPS-OK
  CWD: .
  EVIDENCE: pending
- [ ] N4.2: 集成门禁（typecheck+build:dsh+build）
  CHECK: bash -lc 'pnpm run typecheck >/dev/null 2>&1 && pnpm run build:dsh >/tmp/kr-n4b.log 2>&1 && pnpm run build >/dev/null 2>&1 && echo PLATFORM-INTEGRATION-OK'
  EXPECT: PLATFORM-INTEGRATION-OK
  CWD: .
  EVIDENCE: pending
- [ ] N4.3: bump 干跑——对当前版本执行 bump-dsh.mjs --dry-run，输出步骤计划且零改动；冲突报告格式样例存档至 .agent-workflows/kernel-refactor-plan/logs/
  EVIDENCE: pending
