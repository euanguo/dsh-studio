# Gates: ROOT — kernel-refactor 结构轮完整重构

OWNS: plans/kernel-refactor/**

Scope: target-design.md 全部五条轨道落地；22 叶子全部 VERIFIED；五分支集成账全绿；
结构清零规格转绿；双语文档同步；终审通过。

- [x] RG0: 清零 oracle 自身经过正控自检（探测能力非空洞）
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --self-test
  EXPECT: SELFTEST-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=SELFTEST-OK

- [x] RG1: 全仓 TypeScript 编译通过（每波集成后复跑，终局复测）
  CHECK: bash -lc 'pnpm run typecheck >/tmp/kr-tc.log 2>&1 && echo TYPECHECK-OK'
  EXPECT: TYPECHECK-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=TYPECHECK-OK

- [x] RG2: 全仓测试套件通过（含本轮新增/重写测试）
  CHECK: bash -lc 'pnpm test >/tmp/kr-test.log 2>&1 && echo TESTS-OK'
  EXPECT: TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=TESTS-OK

- [x] RG3: 全仓构建通过并生成可供 surface smoke 使用的构建产物
  CHECK: bash -lc 'unset ELECTRON_RUN_AS_NODE; pnpm run build >/tmp/kr-build.log 2>&1 && pnpm run stage:dsh >/tmp/kr-stage.log 2>&1 && pnpm run smoke:web >/tmp/kr-smoke-web.log 2>&1 && pnpm run smoke:pack >/tmp/kr-smoke-pack.log 2>&1 && echo BUILD-SURFACES-OK'
  EXPECT: BUILD-SURFACES-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=BUILD-SURFACES-OK

- [x] RG4: 随仓 guard 全绿（含本轮新增 guard）
  CHECK: bash -lc 'pnpm run check:guards >/tmp/kr-guards.log 2>&1 && echo GUARDS-OK'
  EXPECT: GUARDS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=GUARDS-OK

- [x] RG5: 结构清零聚合规格转绿（root-legacy.json 全部禁用符号/文件清零）
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/root-legacy.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ABSENT-OK

- [x] RG6: 计划包内全部台账 lint 通过
  CHECK: node plans/kernel-refactor/scripts/lint-package.mjs
  EXPECT: PACKAGE-LINT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=pass gates/node-5.md: LINT OK (2 warning(s)) | PACKAGE-LINT-OK

- [x] RG7: 所有 dispatch 波均已返回且状态有效（终态）
  CHECK: node -e "const d=JSON.parse(require('fs').readFileSync('.unlazy/kernel-refactor/dispatch.json','utf8'));const waves=Object.keys(d.waves||{});if(!waves.length){console.log('ALL-WAVES-RETURNED');process.exit(0)}const{execFileSync}=require('child_process');for(const w of waves){execFileSync('node',['/Users/verger/.agents/skills/unlazy/scripts/dispatch-check.mjs','status','--scope','kernel-refactor','--wave',w],{stdio:'pipe'})}console.log('ALL-WAVES-RETURNED')"
  EXPECT: ALL-WAVES-RETURNED
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ALL-WAVES-RETURNED

- [x] RG8: 终审——重读当前请求与 PLAN 契约清单 O1-O21 逐行对账；抽三叶 diff 复核无 shim/deprecated 别名/re-export 桥/双读双写通道；双语 docs 同步在场（design.md 与 design.en.md 内核章节、workbench-architecture.md 状态翻转）；遗留豁免逐项有裁决记录
  EVIDENCE: O1–O21 reconciled line-by-line against the PLAN inventory (PLAN.md:58-78) — every O maps to a leaf ledger now ALL MET, including repaired O2/leaf-4.2 (W7R) and O14/leaf-1.7 (W7). Three-leaf diff sampling over `git diff HEAD` (13,382 insertions / 138 files): (a) leaf-1.7 WorkspaceEvents — absence oracle ABSENT-OK plus six behavior tests prove the old list-subscription path is gone, not wrapped; (b) leaf-2.1/O4 shell identity — desktop-identity.ts is the sole naming source (main/menu/windows/update-manager/host all import it), no second branding read added to main.ts; (c) leaf-3.2/O16 journal — v1 records exist only as a documented read-side lazy upgrade (journal.ts:24), all writes are v2, no parallel channel. Global anti-pattern scan of added lines: 0 `@deprecated`/compat-shim markers; exactly one added re-export (`export type { DesktopPanels } from './terminal/plugin.tsx'`) which is the sanctioned live service type needed by the native menu, not an alias bridge; 0 new localStorage/sessionStorage writes. Bilingual docs presence recorded under leaf-5.4 G1/G2 (DOCS-KERNEL-SYNC-OK, STATUS-FLIPPED-OK) and semantically signed off by an independent reviewer (REVIEW-SIGNOFF-OK). Exemption adjudications on record: dead-export allowlist (182 entries, per-module reasons in scripts/guards/README.md), guard-no-localstorage whitelist, guards abandonment table, Q8 rule-death ruling in leaf-5.2 G4.
