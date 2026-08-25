# Gates: ROOT — kernel-refactor 结构轮完整重构

OWNS: plans/kernel-refactor/**

Scope: target-design.md 全部五条轨道落地；20 叶子全部 VERIFIED；五分支集成账全绿；
结构清零规格转绿；双语文档同步；终审通过。

- [ ] RG0: 清零 oracle 自身经过正控自检（探测能力非空洞）
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --self-test
  EXPECT: SELFTEST-OK
  CWD: .
  EVIDENCE: pending

- [ ] RG1: 全仓 TypeScript 编译通过（每波集成后复跑，终局复测）
  CHECK: bash -lc 'pnpm run typecheck >/tmp/kr-tc.log 2>&1 && echo TYPECHECK-OK'
  EXPECT: TYPECHECK-OK
  CWD: .
  EVIDENCE: pending

- [ ] RG2: 全仓测试套件通过（含本轮新增/重写测试）
  CHECK: bash -lc 'pnpm test >/tmp/kr-test.log 2>&1 && echo TESTS-OK'
  EXPECT: TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] RG3: 全仓构建通过
  CHECK: bash -lc 'pnpm run build >/tmp/kr-build.log 2>&1 && echo BUILD-OK'
  EXPECT: BUILD-OK
  CWD: .
  EVIDENCE: pending

- [ ] RG4: 随仓 guard 全绿（含本轮新增 guard）
  CHECK: bash -lc 'pnpm run check:guards >/tmp/kr-guards.log 2>&1 && echo GUARDS-OK'
  EXPECT: GUARDS-OK
  CWD: .
  EVIDENCE: pending

- [ ] RG5: 结构清零聚合规格转绿（root-legacy.json 全部禁用符号/文件清零）
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/root-legacy.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: pending

- [ ] RG6: 计划包内全部台账 lint 通过
  CHECK: node plans/kernel-refactor/scripts/lint-package.mjs
  EXPECT: PACKAGE-LINT-OK
  CWD: .
  EVIDENCE: pending

- [ ] RG7: 所有 dispatch 波均已返回且状态有效（终态）
  CHECK: node -e "const d=JSON.parse(require('fs').readFileSync('.unlazy/kernel-refactor/dispatch.json','utf8'));const waves=Object.keys(d.waves||{});if(!waves.length){console.log('ALL-WAVES-RETURNED');process.exit(0)}const{execFileSync}=require('child_process');for(const w of waves){execFileSync('node',['/Users/verger/.agents/skills/unlazy/scripts/dispatch-check.mjs','status','--scope','kernel-refactor','--wave',w],{stdio:'pipe'})}console.log('ALL-WAVES-RETURNED')"
  EXPECT: ALL-WAVES-RETURNED
  CWD: .
  EVIDENCE: pending

- [ ] RG8: 终审——重读当前请求与 PLAN 契约清单 O1-O21 逐行对账；抽三叶 diff 复核无 shim/deprecated 别名/re-export 桥/双读双写通道；双语 docs 同步在场（design.md 与 design.en.md 内核章节、workbench-architecture.md 状态翻转）；遗留豁免逐项有裁决记录
  EVIDENCE: pending
