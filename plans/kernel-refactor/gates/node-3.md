# Gates: node-3 — marketplace-transaction 分支集成

Scope: leaf-3.1…3.3 全部 VERIFIED 后：相位机显式、崩溃窗口有对账、allowBuild 整块
重生成、错误留存。

- [x] N3.0: 分支子账全部复验（--reverify 三叶）
  EVIDENCE: gate-check --approve --reverify over leaf-3.1…leaf-3.3 → all three ALL MET with runnable gates rerun (reran 2/3/2), 0 failures.
- [x] N3.1: 市场事务测试全绿（相位守卫/reconcile fixture/allowBuild/错误留存/push 顺序）
  CHECK: bash -lc 'node --test tests/marketplace-phases.test.ts tests/marketplace-reconcile.test.ts tests/marketplace-allowbuild.test.ts tests/plugin-marketplace-store.test.ts >/tmp/kr-n3.log 2>&1 && echo MKT-TESTS-OK'
  EXPECT: MKT-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; MKT-TESTS-OK (log /tmp/kr-n3.log).
- [x] N3.2: 集成门禁（typecheck+build）+ 现有市场契约测试不回归
  CHECK: bash -lc 'pnpm run typecheck >/dev/null 2>&1 && node --test tests/plugin-marketplace*.test.ts >/dev/null 2>&1 && pnpm run build >/dev/null 2>&1 && echo MKT-INTEGRATION-OK'
  EXPECT: MKT-INTEGRATION-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=MKT-INTEGRATION-OK
- [x] N3.3: 实机事务演练——DEV 桌面安装一个测试仓库插件走 prepare→preview→apply→undo 全链，再模拟 kill -9 于 apply 中段后重启验证自动还原（dsh-desktop-verify 流程留证）
  EVIDENCE: dsh-desktop-verify flow, chrome-use sessions `dsh-node33`/`dsh-node33r`, test plugin `dsh-commit-review` (github:the-qian/dsh-commit-review#40a21f0a…, risk 低). Full chain verified live: 预览安装 prepared an isolated preview ("正在隔离预览窗口中运行" banner, steps 1 检查 → 2 预览 → 3 应用, TOFU 来源锁 首次使用), RiskConfirmation ("原子替换 Profile，并保留上一版本用于恢复") consented → 应用到桌面端 → marketplace showed 已安装 1 / card 已启用 after the runtime reload (screenshot tmp/desktop-verify/w7/screenshots/09-n33-applied-installed.png). Undo via 预览卸载 → same confirmation → back to 已安装 0 / card 未安装 (10-n33-uninstalled.png). Crash drill: reinstall reached apply confirmation, confirm clicked then the Electron main process was SIGKILLed 0.4 s later (KILLED, CDP-DOWN); ensure-helper restart brought the desktop back and the marketplace self-reconciled to the previous profile — 已安装 0, card 未安装, no dangling preview banner (11-n33-recovered-after-kill9.png); ~/.dsh-studio-dev/plugin-marketplace/{previews,rollbacks} empty after recovery. Stale esbuild lines about "#rollback" in dev-desktop.log predate the final bundle — current source declares those fields and typecheck/build pass.
