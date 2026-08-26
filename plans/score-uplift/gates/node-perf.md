# Gates: node-perf — 性能分支集成

- [x] P1: 子账复验（P1/P2）
  EVIDENCE: gate-check --approve --reverify each → P1 ALL MET (G1/G2 reran; G3 DOM evidence accepted after one driver-driven fix iteration), P2 ALL MET (ADR path rerun).
- [x] P2: 市场行为+依赖 guard 聚合复跑
  CHECK: bash -lc 'node --test tests/marketplace-phases.test.ts tests/marketplace-reconcile.test.ts tests/plugin-marketplace-store.test.ts && node scripts/guards/guard-dsh-dependencies.mjs && echo PERF-INTEG-OK'
  EXPECT: PERF-INTEG-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=GUARD-OK | PERF-INTEG-OK
- [x] P3: DEV 实机 DOM 取证交叉核对（人工）
  EVIDENCE: chrome-use session dsh-sup1 on port 62837, full catalog loaded: BEFORE = 588 grid rows / 1764 buttons with dead windowing (scrollTop probe froze count); AFTER worker fix = single bounded scroller vpH=489, 8 virtual rows / 24 mounted buttons at rest, scrolling to offset 30000 slides window to 36 cards with content advancing, search 'zotero' filters to 4 cards and footer count syncs, detail opens on click. Formula cols≈3 × (ceil(489/112)+2×overscan 3) ≈ 24–36 matches measurement. Screenshot: tmp/desktop-verify/score-uplift/p1-windowed-grid-scrolled.png.
