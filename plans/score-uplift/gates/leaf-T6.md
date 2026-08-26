# Gates: leaf-T6 — runtime smoke 多平台决策

OWNS: .github/workflows/nightly-smoke.yml, plans/score-uplift/notes/adr-nightly-smoke.md

Scope: 二选一：nightly workflow 在 windows/macos 跑现有 xvfb 等价 smoke（留一次手动触发全绿档）；或 ADR 记录推迟理由。禁止不选。

- [x] G1: 决策产物在场
  CHECK: bash -lc 'test -f plans/score-uplift/notes/adr-nightly-smoke.md && echo NIGHTLY-ADR || (test -f .github/workflows/nightly-smoke.yml && echo NIGHTLY-YML)'
  EXPECT: /NIGHTLY-(ADR|YML)/
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=NIGHTLY-YML
    - Gate output: `NIGHTLY-YML`（选择 arm (a)：两个 smoke 均跨平台安全）。
    - Artifact: `.github/workflows/nightly-smoke.yml` — cron `0 3 * * *` +
      workflow_dispatch；matrix [macos-15, macos-15-intel, ubuntu-24.04,
      windows-2025]；checkout → pnpm/action-setup@v4（无 version 输入，packageManager 已钉版）→
      setup-node@v6（node 24, cache pnpm, cache-dependency-path pnpm-lock.yaml）→
      `pnpm install --frozen-lockfile` → build+build:dsh+stage:dsh → smokes；
      timeout-minutes: 60；continue-on-error: false。
    - Platform gating rationale: `smoke:web` 纯 Node + headless Electron
      （--no-sandbox），macos/windows runner 有 GUI 会话无需 xvfb；
      `smoke:pack` 非 win32 分支 `cp -al` 在 darwin 实测可用（CP_AL_OK 探针），
      win32 走 fs.cpSync + pnpm.cmd 兜底——并非 linux-only 设计，
      故 macos/windows 同时跑两个 smoke；仅 Linux 用 `xvfb-run -a` 前缀。
    - YAML validation proof (PyYAML structural parse):
      `NIGHTLY-SMOKE-YAML-VALID: parsed and structurally verified (PyYAML)`
      （断言 name/on.schedule.cron/matrix OS 列表/timeout-minutes=60/
      continue-on-error=false/setup-node with 字段/Linux与非Linux smoke 的 if 与 run）。
