# Gates: leaf-1.4 — StateStore 核心 + comments-record 接入 + keymap 半区删除

OWNS: plugins/workbench/src/client/state/**, plugins/shared/comments-record.ts, plugins/shared/store-persistence.ts, plugins/sidebar/src/client/runtimes/chrome-store.ts, plugins/sidebar/src/client/surfaces/center-surface-persistence.ts, plugins/sidebar/src/client/diff/diff-comments-store.ts, plugins/sidebar/src/client/review/review-comments.ts, plugins/sidebar/src/client/kit/keymap.ts, plugins/shared/ui-chrome-tables.ts, plugins/shared/comments-migration.ts, plugins/capabilities/src/ui-chrome-schemas.ts, plugins/sidebar/src/client/surfaces/file-surface.tsx, plugins/sidebar/src/client/surfaces/diff-renderers.tsx, plugins/sidebar/src/client/diff/multi-diff-file-stack.tsx, scripts/guards/guard-no-localstorage.mjs, tests/state-slice.test.ts, tests/comments-single-writer.test.ts

Scope: defineStateSlice 上线并迁移 chrome-store/center-surfaces；comments 直接接入现有
`plugins/shared/comments-record.ts` canonical owner，禁止新建第二个 comments facade；补
comments cwd scope/version 迁移并把唯一写通道纳入 persistVia/StateStore 语义；keymap
localStorage 半区删除且 guard ALLOWLIST 同步收缩；sanitize 上限统一为 200（Q4 裁决）；
版本策略接口表达 migrate|reset 两档。现有 strict load、retry、changed-before-hydrate
和 center per-mount facade 作为 baseline，只做回归验证，不重写。

- [x] G1: slice 行为测试——set/get/changed-before-hydrate merge/schemaVersion 迁移钩子/onIncompatible 两档语义
  CHECK: bash -lc 'node --test tests/state-slice.test.ts && echo SLICE-TESTS-OK'
  EXPECT: SLICE-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 78.816625 | SLICE-TESTS-OK

- [x] G2: comments-record 回归测试——近期提交已提供的单写者/strict load/并发保护继续成立；新增 cwd 分桶与 version 迁移幂等；legacy localStorage 键一次性读迁移仍工作
  CHECK: bash -lc 'node --test tests/comments-single-writer.test.ts && echo COMMENTS-TESTS-OK'
  EXPECT: COMMENTS-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 125.771208 | COMMENTS-TESTS-OK

- [x] G3: 清零规格转绿——现有 comments-record 已使 chromeRecord 双写者规格保持绿色；keymap 实现与 guard exemption 在本叶完成清零
  CHECK: bash -lc 'for s in leaf-1.4-state leaf-1.4-keymap leaf-1.4-keymap-guard; do node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/$s.json || exit 1; done && echo STATE-ABSENT-OK'
  EXPECT: STATE-ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ABSENT-OK | STATE-ABSENT-OK

- [x] G4: 持久化守卫回归——guard-no-localstorage 在收缩后的 ALLOWLIST 下 GUARD-OK
  CHECK: node scripts/guards/guard-no-localstorage.mjs
  EXPECT: GUARD-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=guard-no-localstorage scanned 201 client files; all persistence goes through host domains | GUARD-OK

- [x] G5: 裁决留痕——Q4 上限常量落点；terminal-sessions 硬拒与 sidebar_layouts informational 两档策略在新接口中的映射；comments-record 不被 StateStore 再包一层——三项说明写入本账
  EVIDENCE: `COMMENTS_SANITIZE_LIMIT = 200` in `plugins/shared/ui-chrome-tables.ts` is consumed by the sanitizer and both workbench/review runtime caps. `persistedSliceBackend` maps an unrecognized or forward terminal-session format to the `reset` tier (the terminal store hard-rejects unknown versions), while the tolerant `sidebar_layouts` document is represented by the `bare` + `onIncompatible:'migrate'` policy. `comments-record.ts` remains the sole canonical comments owner; `persistVia` uses its storage handle directly and no StateStore comments facade exists. The workbench half now carries explicit `cwd` scope on every newly-created row; legacy rows normalize to the dedicated null/legacy bucket without arbitrary cwd assignment. Parent repair reverified the host schema and all three comment add paths.
