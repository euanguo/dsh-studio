# Gates: leaf-3.3 — allowBuild 整块重生成 + 错误留存

OWNS: plugins/plugin-marketplace/src/host/transaction-manager.ts, plugins/plugin-marketplace/src/client/store.ts, tests/marketplace-allowbuild.test.ts, tests/plugin-marketplace-store.test.ts

Scope: allowBuild 弃正则手术改整块协议——剥标记块→校验块外无 allowBuilds 键→确定性重生成
块内容（标记格式不变以兼容既有 staged 树）；dispatch 成功路径不再立即清 error（留存至被
下一次成功操作取代）。当前 baseline 的 `acceptPush` 与 `9efaadf` monotonic token 不重写，
只补客户端旧异步 snapshot 不得覆盖新 push 的行为回归。

- [x] G1: 整块重生成行为测试——幂等重跑字节稳定；块外出现 allowBuilds 键即拒绝并报告行号；周围 YAML 字节不损伤（含引号包名/注释/CRLF 用例）
  CHECK: bash -lc 'node --test tests/marketplace-allowbuild.test.ts && echo ALLOWBUILD-TESTS-OK'
  EXPECT: ALLOWBUILD-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 167.429709 | ALLOWBUILD-TESTS-OK

- [x] G2: 行为回归——失败 error 跨多次 getSnapshot 存活；下一次成功 dispatch 后清除；agent-gateway defer 失败进入留存；旧异步 push snapshot 不得覆盖新 push（验证 `9efaadf` monotonic token）
  CHECK: bash -lc 'node --test tests/marketplace-allowbuild.test.ts tests/plugin-marketplace-store.test.ts && echo ERROR-PUSH-RETENTION-OK'
  EXPECT: ERROR-PUSH-RETENTION-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 171.187625 | ERROR-PUSH-RETENTION-OK

- [x] G3: 兼容性人工确认——与 .stage/dsh-runtime 内现网 pnpm-workspace.yaml 样例对拍（存在则实跑一次 allowBuild 幂等校验），记录样例来源
  EVIDENCE: `.stage/dsh-runtime` contains no `pnpm-workspace.yaml`, so a read-only in-memory probe ran against the real channel-home samples at `~/.dsh-studio-dev/profiles/desktop/pnpm-workspace.yaml`, `~/.dsh-studio/profiles/desktop/pnpm-workspace.yaml`, and `~/.dsh-studio/profiles/web/pnpm-workspace.yaml`. Each sample produced one managed block, was byte-stable on a second regeneration, and preserved the non-managed prefix; no user file was written. Evidence: `logs/leaf-3.3-g3.log` ending `ALLOWBUILD-SAMPLE-G3-OK`.
