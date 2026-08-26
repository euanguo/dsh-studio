# Gates: leaf-4.1 — 依赖事实单一来源（config/dsh-dependencies.json）

OWNS: config/dsh-dependencies.json, scripts/sync-dsh-dependencies.mjs, scripts/sync-dsh-dependencies.d.mts, scripts/build-dsh.mjs, scripts/build.mjs, package.json, tsconfig.json, dsh-source.json, scripts/guards/guard-dsh-dependencies.mjs, tests/dsh-dependencies.test.ts

Scope: @deepseek-ai 依赖事实（pin/inject/externals/typePackages/bundles）收敛为单一可写点；
生成器派生 dsh-source.json、package.json inject、build externals 消费、tsconfig 种子；
guard 对拍五处清单互为一致。行为不变——生成物与现状逐字节等价（首次运行即幂等）。

- [x] G1: 同步生成器幂等——对已同步的工作区重跑报告无差异
  CHECK: node scripts/sync-dsh-dependencies.mjs --check
  EXPECT: SYNC-CLEAN
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=SYNC-CLEAN

- [x] G2: 对拍 guard 通过——inject ⊆ cordis.patch.yml insert ⊆ profile.ts BUNDLED_*；externals 覆盖源码全部 @deepseek-ai import；五清单与事实源一致
  CHECK: node scripts/guards/guard-dsh-dependencies.mjs
  EXPECT: GUARD-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=guard-dsh-dependencies reconciled pin/inject/tsconfig/patch/profile/bundles (8 inject, 30 typePackages, 54 distinct @deepseek-ai import sites covered) | GUARD-OK

- [x] G3: 行为测试——生成器的派生规则（含 exports.types 解析、externals 白名单合成、inject 排序）有 fixture 覆盖
  CHECK: bash -lc 'node --test tests/dsh-dependencies.test.ts && echo DEPS-TESTS-OK'
  EXPECT: DEPS-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 108.26125 | DEPS-TESTS-OK

- [x] G4: 人工核对——scripts/build.mjs 中 L182-184/L198-207 硬编码数组已改为读 config/dsh-dependencies.json，文件中不再存在第二份手写清单；记录前后 diff 要点到本账
  EVIDENCE: 前：L182-184 capabilities host 字面量 ['@deepseek-ai/*','cordis','node-pty','schemastery','ws','zod']；L198-207 client 字面量（react 族 + desktop-skins/sidebar/desktop-left-rail 条件加 runtime/client + ui-primitives 收尾）。后：均改经 config 派生函数 hostExternalsFor/clientExternalsFor（切换前按 9 个插件目录做集合等价探针 EXTERNALS-EQUIVALENT）；另将 mermaid 懒 chunk 的 react 三元组一并收口为 clientBaseExternals（该 chunk React-free，输出不变）。残留字面量均非五清单事实：'electron' 是桌面壳平台边界选项；插件 bundle 表（pluginPackages）按 PLAN 归 leaf-1.1（"scripts/build.mjs(插件表读配置)"）。

- [x] G5: build:dsh 的 npm type sandbox 复用 sync-dsh-dependencies 的 exports.types 派生；不再保留第二份 tsconfig/type-resolution 实现
  CHECK: node scripts/guards/guard-dsh-dependencies.mjs --build-dsh
  EXPECT: BUILD-DSH-SINGLE-SOURCE-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=BUILD-DSH-SINGLE-SOURCE-OK

Handoff: after leaf-4.1 verification, `config/dsh-dependencies.json` registration edits are explicitly owned by leaf-1.1 in W2 (Q17); no concurrent config owner is dispatched.
