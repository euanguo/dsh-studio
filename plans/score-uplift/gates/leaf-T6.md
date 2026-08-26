# Gates: leaf-T6 — runtime smoke 多平台决策

OWNS: .github/workflows/nightly-smoke.yml, plans/score-uplift/notes/adr-nightly-smoke.md

Scope: 二选一：nightly workflow 在 windows/macos 跑现有 xvfb 等价 smoke（留一次手动触发全绿档）；或 ADR 记录推迟理由。禁止不选。

- [ ] G1: 决策产物在场
  CHECK: bash -lc 'test -f plans/score-uplift/notes/adr-nightly-smoke.md && echo NIGHTLY-ADR || (test -f .github/workflows/nightly-smoke.yml && echo NIGHTLY-YML)'
  EXPECT: /NIGHTLY-(ADR|YML)/
  CWD: .
  EVIDENCE: pending
