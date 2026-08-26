# Gates: leaf-P1 — 市场网格虚拟化

OWNS: plugins/plugin-marketplace/src/client/marketplace-filters.tsx, plugins/plugin-marketplace/src/client/marketplace-browse.tsx

Scope: 卡片网格改 useVirtualizer（复制 desktop-left-rail/workspace-browser-views 模式）；过滤/选中/详情行为不变；如依赖事实五清单变化需过 sync-dsh-dependencies 与 guard。

- [x] G1: 行为锁定——既有市场测试不改一行全绿
  CHECK: bash -lc 'node --test tests/marketplace-phases.test.ts tests/plugin-marketplace-store.test.ts && echo MKT-P1-OK'
  EXPECT: MKT-P1-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 242.809667 | MKT-P1-OK
- [x] G2: 依赖事实 guard 不受新 import 影响
  CHECK: bash -lc 'node scripts/guards/guard-dsh-dependencies.mjs && echo DEPS-GUARD-OK'
  EXPECT: DEPS-GUARD-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=GUARD-OK | DEPS-GUARD-OK
- [x] G3: DEV 实机挂载节点数取证（人工，chrome-use eval ≤ 视口行×列+overscan，截图留档 tmp/desktop-verify/score-uplift/）
  EVIDENCE: chrome-use session dsh-sup1 (port 62837, catalog fully loaded). BEFORE fix: 588 row divs / 1764 card buttons mounted (no window slide on scrollTop=20000). Root cause of first attempt: the pre-existing outer ScrollArea still wrapped the grid, so my inner scroller had no height bound (nested layers measured 65872px) — restructured so the grid OWNS its scroller and removed the wrapper for that branch. AFTER fix: exactly 1 scroll layer (vpH=489), scrollTop=0 → 8 rows / 24 cards; scrollTop=30000 → window slides (36 cards, first visible title advances); search 'zotero' narrows to 4 cards with footer counter in sync; card click opens PluginDetail. Mounted formula holds: cols≈3 × (ceil(489/112)+2×3) ≈ 24–36 ✓. Screenshot: tmp/desktop-verify/score-uplift/p1-windowed-grid-scrolled.png. G1/G2 rerun post-iteration: 21/21 pass, GUARD-OK.
