# Gates: leaf-4.1 — 依赖事实单一来源（config/dsh-dependencies.json）

OWNS: config/dsh-dependencies.json, scripts/sync-dsh-dependencies.mjs, scripts/build.mjs, package.json, tsconfig.json, dsh-source.json, scripts/guards/guard-dsh-dependencies.mjs, tests/dsh-dependencies.test.ts

Scope: @deepseek-ai 依赖事实（pin/inject/externals/typePackages/bundles）收敛为单一可写点；
生成器派生 dsh-source.json、package.json inject、build externals 消费、tsconfig 种子；
guard 对拍五处清单互为一致。行为不变——生成物与现状逐字节等价（首次运行即幂等）。

- [ ] G1: 同步生成器幂等——对已同步的工作区重跑报告无差异
  CHECK: node scripts/sync-dsh-dependencies.mjs --check
  EXPECT: SYNC-CLEAN
  CWD: .
  EVIDENCE: pending

- [ ] G2: 对拍 guard 通过——inject ⊆ cordis.patch.yml insert ⊆ profile.ts BUNDLED_*；externals 覆盖源码全部 @deepseek-ai import；五清单与事实源一致
  CHECK: node scripts/guards/guard-dsh-dependencies.mjs
  EXPECT: GUARD-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 行为测试——生成器的派生规则（含 exports.types 解析、externals 白名单合成、inject 排序）有 fixture 覆盖
  CHECK: bash -lc 'node --test tests/dsh-dependencies.test.ts && echo DEPS-TESTS-OK'
  EXPECT: DEPS-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G4: 人工核对——scripts/build.mjs 中 L182-184/L198-207 硬编码数组已改为读 config/dsh-dependencies.json，文件中不再存在第二份手写清单；记录前后 diff 要点到本账
  EVIDENCE: pending
