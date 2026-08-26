# Gates: leaf-3.2 — journal v2 意图前置 + 启动对账

OWNS: plugins/plugin-marketplace/src/host/journal.ts, plugins/plugin-marketplace/src/host/transaction-manager.ts, tests/marketplace-reconcile.test.ts

Scope: 新增 host/journal.ts：current.json v2 {version,phase,committed}，apply/undo 在第一次
rename 前预写意图、成功后落终态（修 W1-W5/U1-U3 窗口根因）；构造时 reconcile() 按调研 D
七行判定表对账（backup 还原/failed-candidate 与 replaced-* 清扫/孤儿 tx 回收），全部修复
动作 warn 先行；v1 rollback.json 缺 version 视为 applied 懒升级，绝不批量改写。

- [x] G1: 崩溃窗口 fixture 测试——W1..W5 与 U1..U3 九种磁盘状态各自重建于临时目录，reconcile 结果逐一断言（含致命态 P✗B✗ 的空 profile 重建+error 快照）
  CHECK: bash -lc 'node --test tests/marketplace-reconcile.test.ts && echo RECONCILE-TESTS-OK'
  EXPECT: RECONCILE-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 160.722 | RECONCILE-TESTS-OK

- [x] G2: v1 兼容测试——旧格式读为 phase='applied'/committed=true；下一次成功事务原子升级 v2；升级过程崩溃不留半文件
  CHECK: bash -lc 'node --test --test-name-pattern="v1" tests/marketplace-reconcile.test.ts >/dev/null 2>&1 && node --test tests/marketplace-reconcile.test.ts >/dev/null 2>&1 && printf "%s\n" V1-COMPAT-COVERED'
  EXPECT: V1-COMPAT-COVERED
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=V1-COMPAT-COVERED

- [x] G3: 对账副作用收口——removeTree 清理失败在对账路径上显式上报（不再静默 onWarn 吞掉影响判定假设的平台失败）
  CHECK: bash -lc 'grep -n "removeTree" plugins/plugin-marketplace/src/host/journal.ts | head -1 && node --test tests/marketplace-reconcile.test.ts && echo RECONCILE-FS-OK'
  EXPECT: RECONCILE-FS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 155.884291 | RECONCILE-FS-OK

- [x] G4: 人工确认——journal 预写点位于两个 renameSync 之前（代码走查行号记录）；实机 kill -9 中段演练由 node-3.3 承接
  EVIDENCE: apply intent `writeJournal` at transaction-manager.ts:1139 precedes profile/candidate renames at 1149-1150; undo intent at 1223 precedes renames at 1232-1233; terminal applied record at 1191 follows successful swap; node-3.3 owns the real kill-9 exercise.
