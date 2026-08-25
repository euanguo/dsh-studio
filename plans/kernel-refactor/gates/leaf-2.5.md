# Gates: leaf-2.5 — bootstrap 收缩验收

OWNS: src/main.ts

Scope: 全部抽取完成后的终态验收：main.ts 为纯组合接线 ≤250 行；无任何业务逻辑残段；
顶层兜底错误路径仍可用。

- [ ] G1: 行数预算
  CHECK: node -e "const fs=require('fs');const n=fs.readFileSync('src/main.ts','utf8').split('\n').length;if(n>250){console.error('main.ts lines='+n);process.exit(1)}console.log('MAIN-BUDGET-OK '+n)"
  EXPECT: /MAIN-BUDGET-OK/
  CWD: .
  EVIDENCE: pending

- [ ] G2: 壳层全量回归——identity/lifecycle/handshake/相邻模块测试一次跑绿
  CHECK: bash -lc 'node --test tests/desktop-identity.test.ts tests/desktop-lifecycle.test.ts tests/runtime-handshake.test.ts tests/cli.test.ts && echo SHELL-FINAL-OK'
  EXPECT: SHELL-FINAL-OK
  CWD: .
  EVIDENCE: pending
