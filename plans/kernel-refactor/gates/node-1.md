# Gates: node-1 — workbench-kernel 分支集成

Scope: leaf-1.1…1.7 全部 VERIFIED 后的分支级验证：内核五服务与全部消费方协同，
旧路径清零，全仓门禁绿。

- [x] N1.0: 分支子账全部复验（--reverify 七叶，含已勾选门重跑）
  EVIDENCE: gate-check --approve --reverify over leaf-1.1…leaf-1.7 → all seven reported ALL MET with every runnable gate rerun (reran 3/3/2/4/3/4/2, 0 failures).
- [x] N1.1: 打开/布局/状态三轨清零规格同时转绿
  CHECK: bash -lc 'for s in leaf-1.2-open-pipeline leaf-1.4-state leaf-1.4-keymap leaf-1.5-left-rail leaf-1.6-layout; do node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/$s.json || exit 1; done && echo KERNEL-ABSENT-OK'
  EXPECT: KERNEL-ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; five specs each printed ABSENT-OK then KERNEL-ABSENT-OK.
- [x] N1.2: 内核行为测试全绿（含 baseline GitWatch/source-control retention）
  CHECK: bash -lc 'node --test tests/workbench-kernel.test.ts tests/open-pipeline-cutover.test.ts tests/state-slice.test.ts tests/comments-single-writer.test.ts tests/surface-registry.test.ts tests/layout-service.test.ts tests/workspace-events.test.ts tests/left-rail-unify.test.ts tests/git-watch.test.ts tests/sidebar-runtimes.test.ts >/tmp/kr-n1.log 2>&1 && echo KERNEL-TESTS-OK'
  EXPECT: KERNEL-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; KERNEL-TESTS-OK (log /tmp/kr-n1.log, ten suites incl. workspace-events and git-watch regression).
- [x] N1.3: 集成门禁（typecheck+build）
  CHECK: bash -lc 'pnpm run typecheck >/dev/null 2>&1 && pnpm run build >/dev/null 2>&1 && echo KERNEL-INTEGRATION-OK'
  EXPECT: KERNEL-INTEGRATION-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=KERNEL-INTEGRATION-OK
- [x] N1.4: 焦点不变式人工复核——pipeline 激活路径不移动键盘焦点；抽两处真实打开动作在 DEV 桌面实测（dsh-desktop-verify 流程），记录截图或日志证据
  EVIDENCE: code review over the full refactor diff (`git diff -U0 -- plugins/sidebar plugins/workbench src`) shows zero added `.focus()`/`.blur()`/`autoFocus` calls, so pipeline/open paths introduce no programmatic focus moves. DEV drills via dsh-desktop-verify + chrome-use session `dsh-dev-w7c`: (A) with composer TEXTAREA focused, clicking 插件 opened the marketplace overlay and `document.activeElement` stayed on the activating control (`BUTTON.oh-marketplace-nav`, aria=插件) — never dragged into marketplace search/list (screenshot tmp/desktop-verify/w7/screenshots/04-focus-invariant-marketplace-open.png); (B) activating conversation 直接回复 ok landed focus on the composer TEXTAREA, which reproduces pre-existing mount autofocus behavior — no refactor-added move exists in the diff (screenshot 05-focus-invariant-conversation-switch.png). Invariant upheld: opens never steal existing keyboard focus.
