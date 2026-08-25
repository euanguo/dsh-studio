# Gates: node-3 — marketplace-transaction 分支集成

Scope: leaf-3.1…3.3 全部 VERIFIED 后：相位机显式、崩溃窗口有对账、allowBuild 整块
重生成、错误留存。

- [ ] N3.0: 分支子账全部复验（--reverify 三叶）
  EVIDENCE: pending
- [ ] N3.1: 市场事务测试全绿（相位守卫/reconcile fixture/allowBuild/错误留存）
  CHECK: bash -lc 'node --test tests/marketplace-phases.test.ts tests/marketplace-reconcile.test.ts tests/marketplace-allowbuild.test.ts >/tmp/kr-n3.log 2>&1 && echo MKT-TESTS-OK'
  EXPECT: MKT-TESTS-OK
  CWD: .
  EVIDENCE: pending
- [ ] N3.2: 集成门禁（typecheck+build）+ 现有市场契约测试不回归
  CHECK: bash -lc 'pnpm run typecheck >/dev/null 2>&1 && node --test tests/plugin-marketplace*.test.ts >/dev/null 2>&1; pnpm run build >/dev/null 2>&1 && echo MKT-INTEGRATION-OK'
  EXPECT: MKT-INTEGRATION-OK
  CWD: .
  EVIDENCE: pending
- [ ] N3.3: 实机事务演练——DEV 桌面安装一个测试仓库插件走 prepare→preview→apply→undo 全链，再模拟 kill -9 于 apply 中段后重启验证自动还原（dsh-desktop-verify 流程留证）
  EVIDENCE: pending
