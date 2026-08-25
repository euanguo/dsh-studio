# Gates: node-1 — workbench-kernel 分支集成

Scope: leaf-1.1…1.7 全部 VERIFIED 后的分支级验证：内核五服务与全部消费方协同，
旧路径清零，全仓门禁绿。

- [ ] N1.0: 分支子账全部复验（--reverify 七叶，含已勾选门重跑）
  EVIDENCE: pending
- [ ] N1.1: 打开/布局/状态三轨清零规格同时转绿
  CHECK: bash -lc 'for s in leaf-1.2-open-pipeline leaf-1.4-state leaf-1.4-keymap leaf-1.5-left-rail leaf-1.6-layout; do node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/$s.json || exit 1; done && echo KERNEL-ABSENT-OK'
  EXPECT: KERNEL-ABSENT-OK
  CWD: .
  EVIDENCE: pending
- [ ] N1.2: 内核行为测试全绿
  CHECK: bash -lc 'node --test tests/workbench-kernel.test.ts tests/open-pipeline-cutover.test.ts tests/state-slice.test.ts tests/comments-single-writer.test.ts tests/surface-registry.test.ts tests/layout-service.test.ts tests/workspace-events.test.ts tests/left-rail-unify.test.ts >/tmp/kr-n1.log 2>&1 && echo KERNEL-TESTS-OK'
  EXPECT: KERNEL-TESTS-OK
  CWD: .
  EVIDENCE: pending
- [ ] N1.3: 集成门禁（typecheck+build）
  CHECK: bash -lc 'pnpm run typecheck >/dev/null 2>&1 && pnpm run build >/dev/null 2>&1 && echo KERNEL-INTEGRATION-OK'
  EXPECT: KERNEL-INTEGRATION-OK
  CWD: .
  EVIDENCE: pending
- [ ] N1.4: 焦点不变式人工复核——pipeline 激活路径不移动键盘焦点；抽两处真实打开动作在 DEV 桌面实测（dsh-desktop-verify 流程），记录截图或日志证据
  EVIDENCE: pending
