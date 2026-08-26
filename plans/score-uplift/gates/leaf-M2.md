# Gates: leaf-M2 — capabilities apply() 工厂化

OWNS: plugins/capabilities/src/index.ts, plugins/capabilities/src/factories

Scope: 496 行 apply() 拆为 {face,dispose} 工厂（terminal assembly/settings/ui-chrome/tool gate sync），闭包共享可变态显式传参；wire 行为零变化。

- [x] G1: wire 契约锁定
  CHECK: bash -lc 'node --test tests/capabilities-wire-contract.test.ts tests/dsh-dependencies.test.ts && echo WIRE-LOCKED-OK'
  EXPECT: WIRE-LOCKED-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 122.66 | WIRE-LOCKED-OK
- [x] G2: index.ts 体量预算
  CHECK: node -e "const n=require('fs').readFileSync('plugins/capabilities/src/index.ts','utf8').split('\n').length;if(n>=350){console.error('fail '+n);process.exit(1)}console.log('APPLY-BUDGET-OK '+n)"
  EXPECT: /APPLY-BUDGET-OK/
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=APPLY-BUDGET-OK 215
