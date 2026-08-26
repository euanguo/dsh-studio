# Gates: leaf-1.7 — WorkspaceEvents 切换事件源

OWNS: plugins/workbench/src/events.ts, plugins/sidebar/src/client/plugin.tsx, plugins/sidebar/src/client/workspace-tools.tsx, plugins/sidebar/src/client/workspace-panel.tsx, plugins/sidebar/src/client/surfaces/center-surface-add-menu.tsx, plugins/sidebar/src/client/subagent/subagent-panel.tsx, plugins/sidebar/src/client/review/review-comments.ts, plugins/sidebar/src/client/runtimes/registry.ts, plugins/pinned-summary/src/service.ts, plugins/plugin-marketplace/src/client/session-navigation.ts, plugins/sidebar/src/client/surfaces/center-surface-tabs.tsx, tests/workspace-events.test.ts

Scope: onWorkspaceChanged/onSessionChanged 两类身份事件上线；替换调研 A 表4 十个分散订阅点
（保留"同 cwd 换 session ≠ 换 cwd"双语义分支映射）；runtime registry 接 workspaceChanged
做缓存失效（修 cwd 键永不过期缺口）。GitWatchCoordinator/websocket 是独立资源新鲜度
事件，必须保留，不迁入本服务；SourceControlRuntime 的 history/branch retention 与
顶层 gitStatus error 传播也必须保留。

- [x] G1: 事件行为测试——两类事件触发时序、多订阅者顺序、registry 失效后重建取新数据、会话切换分支 retain/activate/deactivate 映射；GitWatch push 与 source-control retention 回归
  CHECK: bash -lc 'node --test tests/workspace-events.test.ts tests/git-watch.test.ts tests/sidebar-runtimes.test.ts && echo EVENTS-TESTS-OK'
  EXPECT: EVENTS-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 99.386083 | EVENTS-TESTS-OK

- [x] G2: 清零规格转绿——消费方插件中 sessions list 直订清零
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-1.7-events.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ABSENT-OK

- [x] G3: 人工核对——十个原订阅点逐条指认新事件订阅或显式删除理由；切 worktree 往返恢复在 DEV 实机验证（dsh-desktop-verify 留证）
  EVIDENCE: manual review complete. Identity subscriptions were cut over as follows: (1) sidebar/plugin.tsx now has the single `forwardSessionIdentity` pump plus workspace/session handlers and runtime invalidation; (2) workspace-tools.tsx retains only a React render snapshot subscription, not an imperative identity listener; (3) center-surface-host.tsx retains only the render snapshot feed; (4) center-surface-tabs.tsx retains only the render snapshot feed and preserves same-cwd `activate` versus cwd-change `restore` through `currentConversationSyncAction`; (5) center-surface-add-menu.tsx retains only render reads for current workspace selection; (6) workspace-panel.tsx retains only render reads and remounts by cwd; (7) subagent-panel.tsx retains only render reads for topology/jobs; (8) review-comments.ts now reconciles through onSessionChanged/onWorkspaceChanged; (9) pinned-summary service now rebinds through both identity events while its bound conversation snapshot remains the content-refresh source; (10) marketplace-view now closes on onSessionChanged and seeds from events.snapshot() so startup is not navigation. The absence oracle reports zero direct `list.subscribe(` subscriptions in sidebar, pinned-summary, and marketplace clients; the remaining React `useSyncExternalStore(...list.subscribe...)` properties are render feeds and are intentionally not identity subscriptions. DEV evidence used `dsh-desktop-verify` + chrome-use session `dsh-dev-w7`: switched `ui-ux-refactor → wt-ui-demo → ui-ux-refactor`, asserted the workspace picker labels after each transition, and observed `errors`/`console` with no runtime diagnostics. Screenshots: `/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor/tmp/desktop-verify/w7/screenshots/00-workspace-switched-wt-ui-demo.png`, `/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor/tmp/desktop-verify/w7/screenshots/01-workspace-roundtrip-ui-ux-refactor.png`, plus final rerun `/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor/tmp/desktop-verify/w7/screenshots/02-final-workspace-wt-ui-demo.png` and `/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor/tmp/desktop-verify/w7/screenshots/03-final-workspace-ui-ux-refactor.png`.
