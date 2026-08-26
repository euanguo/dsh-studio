# Gates: leaf-1.5 — left-rail 平行体系并轨

OWNS: plugins/desktop-left-rail/src/**, tests/left-rail-unify.test.ts, tests/left-rail-settings-roundtrip.test.ts

Scope: stores.ts defineStore 切片迁 shared/runtime 家族；视图态经 StateStore(left_rail_view)、
用户档经 persistVia settings 后端；删除 createUiChromeStorage 直连与裸 'settings.replace'
RPC 字符串；官方设置页 schema 注册不动。近期 `7595452` 已落地的 `loadStrict` 与
`chromeHydrated=false` 失败保护必须保留，不能因并轨重构而恢复默认值 save-back。

- [x] G1: 视图态行为测试——groupBy/orderBy/expansion/sessionOrder 持久化往返、账户键 retain 清理、hydrate merge 语义与前实现等价；transport failure 时 `chromeHydrated` 保持 false 且不发生 save-back
  CHECK: bash -lc 'node --test tests/left-rail-unify.test.ts && echo LEFTRAIL-UNIFY-OK'
  EXPECT: LEFTRAIL-UNIFY-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 95.543541 | LEFTRAIL-UNIFY-OK

- [x] G2: 清零规格转绿——平行体系三符号在 left-rail 目录清零
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-1.5-left-rail.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ABSENT-OK

- [x] G3: left-rail 既有测试回归
  CHECK: bash -lc 'ls tests/left-rail*.test.ts | xargs node --test && echo LEFTRAIL-REGRESS-OK'
  EXPECT: LEFTRAIL-REGRESS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 119.400292 | LEFTRAIL-REGRESS-OK

- [x] G4: 人工确认——官方 General 设置页 left-rail 区渲染正常（DEV 实机）；settings 域 DTO version 字段与 CAS 信封语义未变
  EVIDENCE: DEV session `dsh-dev-w5` opened the official Settings → Project and WorkTree section and rendered the left-rail WorkTree directory input plus the project-nesting switch. The switch was toggled off and restored on without an error; final snapshot showed it checked. Screenshot: `tmp/desktop-verify/w5/left-rail-settings.png`. G1/G3 roundtrip tests cover the unchanged DTO version stamp and CAS envelope/path-op semantics; the final desktop smoke passed 3/3 and `errors`/`console` were empty.
