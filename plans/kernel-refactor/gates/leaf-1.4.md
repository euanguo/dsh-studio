# Gates: leaf-1.4 — StateStore 核心 + comments 单写者 + keymap 半区删除

OWNS: plugins/workbench/src/client/state/**, plugins/sidebar/src/client/runtimes/chrome-store.ts, plugins/sidebar/src/client/surfaces/center-surface-persistence.ts, plugins/sidebar/src/client/diff/diff-comments-store.ts, plugins/sidebar/src/client/review/review-comments.ts, plugins/sidebar/src/client/kit/keymap.ts, plugins/shared/ui-chrome-tables.ts, plugins/shared/comments-migration.ts, scripts/guards/guard-no-localstorage.mjs, tests/state-slice.test.ts, tests/comments-single-writer.test.ts

Scope: defineStateSlice 上线并迁移 chrome-store/center-surfaces/comments 三切片；
comments 记录收敛单写者 slice（消灭 chromeRecord 双镜像竞态），workbench 评论改按 cwd
分桶（v2→v3 读时迁移非破坏）；keymap localStorage 半区删除且 guard ALLOWLIST 同步收缩；
sanitize 上限统一为 200（Q4 裁决）；版本策略接口表达 migrate|reset 两档。

- [ ] G1: slice 行为测试——set/get/changed-before-hydrate merge/schemaVersion 迁移钩子/onIncompatible 两档语义
  CHECK: bash -lc 'node --test tests/state-slice.test.ts && echo SLICE-TESTS-OK'
  EXPECT: SLICE-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: comments 单写者测试——两族评论并发写同记录无互相覆盖；cwd 分桶迁移幂等；legacy localStorage 键一次性读迁移仍工作
  CHECK: bash -lc 'node --test tests/comments-single-writer.test.ts && echo COMMENTS-TESTS-OK'
  EXPECT: COMMENTS-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 清零规格转绿——chromeRecord 双写者与 keymap 浏览器存储半区清零
  CHECK: bash -lc 'for s in leaf-1.4-state leaf-1.4-keymap; do node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/$s.json || exit 1; done && echo STATE-ABSENT-OK'
  EXPECT: STATE-ABSENT-OK
  CWD: .
  EVIDENCE: pending

- [ ] G4: 持久化守卫回归——guard-no-localstorage 在收缩后的 ALLOWLIST 下 GUARD-OK
  CHECK: node scripts/guards/guard-no-localstorage.mjs
  EXPECT: GUARD-OK
  CWD: .
  EVIDENCE: pending

- [ ] G5: 裁决留痕——Q4 上限常量落点；terminal-sessions 硬拒与 sidebar_layouts informational 两档策略在新接口中的映射说明写入本账
  EVIDENCE: pending
