# Gates: leaf-2.3 — windows/menu/ipc/runtime-options 模块拆分

OWNS: src/windows.ts, src/menu.ts, src/ipc.ts, src/runtime-options.ts, src/main.ts

Scope: createWindow/splash/更新窗/图标/导航守卫 → windows.ts；labels/buildMenu/编辑右键
菜单 → menu.ts；九个 IPC handler 与推送 → ipc.ts；runtime 选项与环境组装 →
runtime-options.ts。纯搬家重构：符号内容不变、消费者接线更新、无新抽象层。

- [x] G1: 相邻模块既有测试不回归（CLI/env/data-root/permissions）
  CHECK: bash -lc 'node --test tests/cli.test.ts tests/desktop-env-guard.test.ts tests/data-root.test.ts tests/permissions.test.ts && echo SHELL-NEIGHBORS-OK'
  EXPECT: SHELL-NEIGHBORS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 303.136333 | SHELL-NEIGHBORS-OK

- [x] G2: 拆分完整性人工核对——四新模块各自吸收 PLAN OWNS 表所列行区间符号；main.ts 不再包含这些函数体（grep 函数名确认唯一声明点）；常量未复制副本（TRAFFIC_LIGHT_* 等单点）
  EVIDENCE: `logs/leaf-2.3-g2.log`: all extracted declarations have exactly one owner in windows.ts/menu.ts/ipc.ts/runtime-options.ts; `check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-2.3-shell-modules.json` → ABSENT-OK; main.ts is composition-only for these symbols (534 lines pending leaf-2.5's ≤150 bootstrap budget); TRAFFIC_LIGHT_POSITION/WIDTH/HEIGHT have exactly one declaration source in windows.ts and are imported by ipc.ts; `SHELL-MODULES-G2-OK`.
