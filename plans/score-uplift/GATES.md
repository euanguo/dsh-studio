# Gates: ROOT — score-uplift 评分提升完整改造

OWNS: plans/score-uplift/**

Scope: 三路评审薄弱点全数落地：安全收口、性能热点、结构神文件、工具链与双语收口；综合评分目标 ≥8.0。基线证据见三路深审报告与本目录 PLAN.md。

- [ ] RG0: 清零 oracle 自检
  CHECK: node /Users/verger/.agents/skills/unlazy/scripts/check-absent.mjs --self-test 2>/dev/null || node plans/kernel-refactor/scripts/check-absent.mjs --self-test
  EXPECT: SELFTEST-OK
  CWD: .
  EVIDENCE: pending
- [ ] RG1: 全仓 typecheck
  CHECK: bash -lc 'pnpm run typecheck >/dev/null 2>&1 && echo TYPECHECK-OK'
  EXPECT: TYPECHECK-OK
  CWD: .
  EVIDENCE: pending
- [ ] RG2: 全仓测试
  CHECK: bash -lc 'pnpm test >/tmp/su-test.log 2>&1 && echo TESTS-OK'
  EXPECT: TESTS-OK
  CWD: .
  EVIDENCE: pending
- [ ] RG3: 构建+staging+web/pack smoke
  CHECK: bash -lc 'unset ELECTRON_RUN_AS_NODE; pnpm run build >/tmp/su-build.log 2>&1 && pnpm run stage:dsh >/tmp/su-stage.log 2>&1 && pnpm run smoke:web >/tmp/su-web.log 2>&1 && pnpm run smoke:pack >/tmp/su-pack.log 2>&1 && echo BUILD-SURFACES-OK'
  EXPECT: BUILD-SURFACES-OK
  CWD: .
  EVIDENCE: pending
- [ ] RG4: 守卫全链
  CHECK: bash -lc 'pnpm run check:guards >/tmp/su-guards.log 2>&1 && echo GUARDS-ROOT-OK'
  EXPECT: GUARDS-ROOT-OK
  CWD: .
  EVIDENCE: pending
- [ ] RG5: 本计划全部台账 lint 通过
  CHECK: bash -lc 'for f in plans/score-uplift/GATES.md plans/score-uplift/gates/*.md; do node /Users/verger/.agents/skills/unlazy/scripts/gate-lint.mjs "$f" >/dev/null || exit 1; done && echo LEDGERS-LINT-OK'
  EXPECT: LEDGERS-LINT-OK
  CWD: .
  EVIDENCE: pending
- [ ] RG6: dispatch 波次终态
  CHECK: node -e "const d=JSON.parse(require('fs').readFileSync('.unlazy/score-uplift/dispatch.json','utf8'));const waves=Object.keys(d.waves||{});if(!waves.length){console.log('ALL-WAVES-RETURNED');process.exit(0)}const{execFileSync}=require('child_process');for(const w of waves){execFileSync('node',['/Users/verger/.agents/skills/unlazy/scripts/dispatch-check.mjs','status','--scope','score-uplift','--wave',w],{stdio:'pipe'})}console.log('ALL-WAVES-RETURNED')"
  EXPECT: ALL-WAVES-RETURNED
  CWD: .
  EVIDENCE: pending
- [ ] RG7: 终审——基线八维弱点逐项对账修复证据；无 shim/deprecated/双写；评分复测口径记录
  EVIDENCE: pending
