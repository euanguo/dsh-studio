# Gates: leaf-5.2 — 结构性残留清零

OWNS: plugins/**, src/update-manager.ts, src/client.ts, plugins/capabilities/src/context-types.ts, scripts/smoke-runtime.mjs, scripts/dead-export-allowlist.json, scripts/guards/guard-dead-exports.mjs, package.json, .github/workflows/ci.yml, scripts/check-sidebar-source.mjs

Scope: 删 errorMessage-sweep.list（Q8 裁决落地：guard-error-idiom 或规则消亡 ADR 二选一）；
删 smoke:runtime 空跑脚本及 package.json/CI 引用；173 处决策码注释改语义注释；
21 处 `// //` 归一；dead-export allowlist 入库 scripts/ 并对 121 候选拍板（26 个 tests-only
判活移出候选）；update-manager/context-types 非 vendor any 清零。

- [x] G1: 残留清零规格转绿——sweep.list/smoke 空跑文件删除；双斜杠标记与 RD-/leaf-R 决策码清零
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-5.2-residue.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ABSENT-OK
- [x] G2: dead-export strict 转绿——入库 allowlist + 候选拍板后 guard --strict 通过
  CHECK: node scripts/guards/guard-dead-exports.mjs --strict
  EXPECT: /GUARD-OK|DEAD-EXPORTS-STRICT-OK/
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=guard-dead-exports: no dead/aging exports outside the allowlist | GUARD-OK
- [x] G3: 非 vendor any 清零规格——update-manager/context-types `: any` 为零
  CHECK: bash -lc '! grep -nE ": any\b" src/update-manager.ts plugins/capabilities/src/context-types.ts && echo ANY-PURGED-OK'
  EXPECT: ANY-PURGED-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ANY-PURGED-OK
- [x] G4: Q8 裁决留痕——sweep.list 处置方式（新 guard 或消亡 ADR）写入本账；若立 guard 则其脚本入 scripts/guards 并有正控用例
  EVIDENCE: Q8 ruling — rule-death ADR (no new guard). The error-idiom rule existed to audit the now-deleted errorMessage-sweep.list; its target idiom has zero occurrences in production scope and the sweep file itself is removed this leaf. A static guard for a provably-zero legacy idiom is an oracle that cannot fail honestly, so it is not promoted into scripts/guards; the discipline lives structurally in the shared errors ownership (`errorMessage` from @dsh-studio/shared/errors, re-exported by commit-files.tsx) and review. The historical agent-side rescan rule remains only in .agent-workflows tooling, outside repo gates. Recorded here as the ruling of record.
- [x] G5: 全量回归——typecheck+test+build 三连绿（注释级清扫不得破坏任何行为）
  CHECK: bash -lc 'pnpm run typecheck >/dev/null 2>&1 && pnpm test >/dev/null 2>&1 && pnpm run build >/dev/null 2>&1 && echo RESIDUE-FINAL-OK'
  EXPECT: RESIDUE-FINAL-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=RESIDUE-FINAL-OK
