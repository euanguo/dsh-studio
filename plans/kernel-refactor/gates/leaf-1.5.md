# Gates: leaf-1.5 — left-rail 平行体系并轨

OWNS: plugins/desktop-left-rail/src/**, tests/left-rail-unify.test.ts

Scope: stores.ts defineStore 切片迁 shared/runtime 家族；视图态经 StateStore(left_rail_view)、
用户档经 persistVia settings 后端；删除 createUiChromeStorage 直连与裸 'settings.replace'
RPC 字符串；官方设置页 schema 注册不动。

- [ ] G1: 视图态行为测试——groupBy/orderBy/expansion/sessionOrder 持久化往返、账户键 retain 清理、hydrate merge 语义与前实现等价
  CHECK: bash -lc 'node --test tests/left-rail-unify.test.ts && echo LEFTRAIL-UNIFY-OK'
  EXPECT: LEFTRAIL-UNIFY-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: 清零规格转绿——平行体系三符号在 left-rail 目录清零
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-1.5-left-rail.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: left-rail 既有测试回归
  CHECK: bash -lc 'ls tests/left-rail*.test.ts | xargs node --test && echo LEFTRAIL-REGRESS-OK'
  EXPECT: LEFTRAIL-REGRESS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G4: 人工确认——官方 General 设置页 left-rail 区渲染正常（DEV 实机）；settings 域 DTO version 字段与 CAS 信封语义未变
  EVIDENCE: pending
