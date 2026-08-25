# Gates: leaf-1.7 — WorkspaceEvents 切换事件源

OWNS: plugins/workbench/src/client/events.ts, plugins/sidebar/src/client/plugin.tsx, plugins/sidebar/src/client/workspace-tools.tsx, plugins/sidebar/src/client/subagent/subagent-panel.tsx, plugins/sidebar/src/client/review/review-comments.ts, plugins/sidebar/src/client/runtimes/registry.ts, plugins/pinned-summary/src/service.ts, plugins/plugin-marketplace/src/client/session-navigation.ts, plugins/sidebar/src/client/surfaces/center-surface-tabs.tsx, tests/workspace-events.test.ts

Scope: onWorkspaceChanged/onSessionChanged 两类事件上线；替换调研 A 表4 十个分散订阅点
（保留"同 cwd 换 session ≠ 换 cwd"双语义分支映射）；runtime registry 接 workspaceChanged
做缓存失效（修 cwd 键永不过期缺口）。

- [ ] G1: 事件行为测试——两类事件触发时序、多订阅者顺序、registry 失效后重建取新数据、会话切换分支 retain/activate/deactivate 映射
  CHECK: bash -lc 'node --test tests/workspace-events.test.ts && echo EVENTS-TESTS-OK'
  EXPECT: EVENTS-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: 清零规格转绿——消费方插件中 sessions list 直订清零
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-1.7-events.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 人工核对——十个原订阅点逐条指认新事件订阅或显式删除理由；切 worktree 往返恢复在 DEV 实机验证（dsh-desktop-verify 留证）
  EVIDENCE: pending
