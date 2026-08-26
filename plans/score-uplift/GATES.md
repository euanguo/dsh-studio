# Gates: ROOT — score-uplift 评分提升完整改造

OWNS: plans/score-uplift/**

Scope: 三路评审薄弱点全数落地：安全收口、性能热点、结构神文件、工具链与双语收口；综合评分目标 ≥8.0。基线证据见三路深审报告与本目录 PLAN.md。

- [x] RG0: 清零 oracle 自检
  CHECK: node /Users/verger/.agents/skills/unlazy/scripts/check-absent.mjs --self-test 2>/dev/null || node plans/kernel-refactor/scripts/check-absent.mjs --self-test
  EXPECT: SELFTEST-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=SELFTEST-OK
- [x] RG1: 全仓 typecheck
  CHECK: bash -lc 'pnpm run typecheck >/dev/null 2>&1 && echo TYPECHECK-OK'
  EXPECT: TYPECHECK-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=TYPECHECK-OK
- [x] RG2: 全仓测试
  CHECK: bash -lc 'pnpm test >/tmp/su-test.log 2>&1 && echo TESTS-OK'
  EXPECT: TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=TESTS-OK
- [x] RG3: 构建+staging+web/pack smoke
  CHECK: bash -lc 'unset ELECTRON_RUN_AS_NODE; pnpm run build >/tmp/su-build.log 2>&1 && pnpm run stage:dsh >/tmp/su-stage.log 2>&1 && pnpm run smoke:web >/tmp/su-web.log 2>&1 && pnpm run smoke:pack >/tmp/su-pack.log 2>&1 && echo BUILD-SURFACES-OK'
  EXPECT: BUILD-SURFACES-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=BUILD-SURFACES-OK
- [x] RG4: 守卫全链
  CHECK: bash -lc 'pnpm run check:guards >/tmp/su-guards.log 2>&1 && echo GUARDS-ROOT-OK'
  EXPECT: GUARDS-ROOT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=GUARDS-ROOT-OK
- [x] RG5: 本计划全部台账 lint 通过
  CHECK: bash -lc 'for f in plans/score-uplift/GATES.md plans/score-uplift/gates/*.md; do node /Users/verger/.agents/skills/unlazy/scripts/gate-lint.mjs "$f" >/dev/null || exit 1; done && echo LEDGERS-LINT-OK'
  EXPECT: LEDGERS-LINT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=LEDGERS-LINT-OK
- [x] RG6: dispatch 波次终态
  CHECK: node -e "const d=JSON.parse(require('fs').readFileSync('.unlazy/score-uplift/dispatch.json','utf8'));const waves=Object.keys(d.waves||{});if(!waves.length){console.log('ALL-WAVES-RETURNED');process.exit(0)}const{execFileSync}=require('child_process');for(const w of waves){execFileSync('node',['/Users/verger/.agents/skills/unlazy/scripts/dispatch-check.mjs','status','--scope','score-uplift','--wave',w],{stdio:'pipe'})}console.log('ALL-WAVES-RETURNED')"
  EXPECT: ALL-WAVES-RETURNED
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ALL-WAVES-RETURNED
- [x] RG7: 终审——基线八维弱点逐项对账修复证据；无 shim/deprecated/双写；评分复测口径记录
  EVIDENCE: Final driver audit: all 12 score-uplift leaves and 4 branch ledgers are ALL MET; RG0-RG6 were independently rerun after the final bootstrap-scope and marketplace-confirmation cleanup. Security R1-R3 are closed by WorkspaceScopeRegistry (bootstrap roots + registered workspaces + live sessions, literal traversal rejection, shared isWithin containment), fenced fs routes, and 27 boundary tests plus 8 scope tests. Performance R4 is closed by marketplace virtualization (independent live measurement 1764 cards at rest reduced to 24-36 mounted cards); R5/R6 by transaction-manager split (751 lines, state-file/allowbuild-yaml/fs-ops modules) and capabilities apply extraction (645→215 lines), with node-structure full triple green. Toolchain R8/R9 are closed by Biome, report-all run-all with strict dead-exports and two-failure negative control, packageManager single source, and node-eng ALL MET. R10 is closed by 4 behavioral Electron-chrome tests covering menu, IPC, workspace paths, and hardened BrowserWindow webPreferences. R11 is closed by required EN docs, interaction-model reference repair, implementation-state docs corrected to four runtime services, and nightly multi-platform workflow. Final live-code scan found no @deprecated, allowBuildScripts compatibility field, compatibility shim, dual-read, or dual-write path; historical plan/changelog wording is retained as audit history only. Final score remeasurement uses the original weighted model with conservative scores A 7.5, B 7.5, C 8.5, D 8.5, E 8.0, F 8.5, G 8.5, H 8.0 and weights .18/.15/.15/.12/.12/.13/.07/.08: weighted result 8.07, reportable score 8.1/10 (above the ≥8.0 target). No score-uplift leases remain; waves w1/w2/w3/w4/w5/w5r are terminal.
