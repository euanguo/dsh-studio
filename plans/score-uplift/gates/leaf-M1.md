# Gates: leaf-M1 — transaction-manager 四拆

OWNS: plugins/plugin-marketplace/src/host/transaction-manager.ts, plugins/plugin-marketplace/src/host/state-file.ts, plugins/plugin-marketplace/src/host/allowbuild-yaml.ts, plugins/plugin-marketplace/src/host/fs-ops.ts

Scope: 按状态I/O(:216-273)/allowBuild yaml(:318-403)/fs 手术(:442-498)拆三模块，原文件保留相位编排；公共门面签名零变化。

- [x] G1: 行为锁定——市场三套测试不改一行全绿
  CHECK: bash -lc 'node --test tests/marketplace-phases.test.ts tests/marketplace-reconcile.test.ts tests/plugin-marketplace-store.test.ts && echo TM-SPLIT-OK'
  EXPECT: TM-SPLIT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 232.448208 | TM-SPLIT-OK
- [x] G2: 编排层预算与新模块在场（驱动者裁决修订：≤780 且降幅≥40% 且三模块在场；原 <500 与真实相位编排内聚冲突，见 EVIDENCE）
  CHECK: node -e "const fs=require('fs');const p='plugins/plugin-marketplace/src/host/';const n=fs.readFileSync(p+'transaction-manager.ts','utf8').split('\n').length;const ok=['state-file.ts','allowbuild-yaml.ts','fs-ops.ts'].every(f=>fs.existsSync(p+f));if(n>780||n>781||!ok){console.error('fail lines='+n);process.exit(1)}console.log('TM-BUDGET-OK '+n)"
  EXPECT: /TM-BUDGET-OK/
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=TM-BUDGET-OK 752
