# Gates: node-2 — desktop-shell 分支集成

Scope: leaf-2.1…2.5 全部 VERIFIED 后：src/ 模块化完成，main.ts 为纯接线，生命周期
由 AppController 状态机持有，就绪协议加固生效。

- [ ] N2.0: 分支子账全部复验（--reverify 五叶）
  EVIDENCE: pending
- [ ] N2.1: 身份与生命周期清零规格转绿
  CHECK: bash -lc 'for s in leaf-2.1-identity leaf-2.2-lifecycle; do node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/$s.json || exit 1; done && echo SHELL-ABSENT-OK'
  EXPECT: SHELL-ABSENT-OK
  CWD: .
  EVIDENCE: pending
- [ ] N2.2: main.ts 行数预算（纯接线 ≤250 行）
  CHECK: node -e "const fs=require('fs');const n=fs.readFileSync('src/main.ts','utf8').split('\n').length;if(n>250){console.error('main.ts lines='+n);process.exit(1)}console.log('MAIN-BUDGET-OK '+n)"
  EXPECT: /MAIN-BUDGET-OK/
  CWD: .
  EVIDENCE: pending
- [ ] N2.3: 壳层测试全绿
  CHECK: bash -lc 'node --test tests/desktop-identity.test.ts tests/desktop-lifecycle.test.ts tests/runtime-handshake.test.ts >/tmp/kr-n2.log 2>&1 && echo SHELL-TESTS-OK'
  EXPECT: SHELL-TESTS-OK
  CWD: .
  EVIDENCE: pending
- [ ] N2.4: 实机冒烟——DEV 桌面启动→就绪→窗口加载→菜单 Settings 打开→退出清理，全程无错误 splash（dsh-desktop-verify 流程留证）
  EVIDENCE: pending
