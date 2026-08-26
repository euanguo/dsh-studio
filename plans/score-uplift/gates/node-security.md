# Gates: node-security — 安全收口分支集成

- [x] N1: 子账复验（S1/S2/S3 全部 --reverify）
  EVIDENCE: gate-check --approve --reverify each → S1 ALL MET (G1 7 tests, G2 11 tests rerun; G3 wording quoted below), S2 ALL MET (27 tests rerun), S3 ALL MET (decision-impl path rerun + driver integration lines logged).
- [x] N2: 路由级回归聚合（wire/inventory/boundaries/scope/push-gate-if-any + dsh-dependencies guard）
  CHECK: bash -lc 'node --test tests/capabilities-wire-contract.test.ts tests/plugin-inventory.test.ts tests/boundaries.test.ts tests/workspace-scope.test.ts && node scripts/guards/guard-dsh-dependencies.mjs && echo SEC-INTEG-OK'
  EXPECT: SEC-INTEG-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=GUARD-OK | SEC-INTEG-OK
- [x] N3: design 双语安全节名实一致终审（人工）
  EVIDENCE: zh (design.md:110-113) and en (design.en.md:163-167) both state: cwd validated by server-side workspace scope registry (registered roots ∪ live session cwds, unregistered → forbidden); reads/writes fenced to session subtree with read anchor on server-resolved repo root for subdirectory sessions; loopback fence explicitly transport hygiene, not authentication. Semantically equivalent and matches workspace-scope.ts behavior.
