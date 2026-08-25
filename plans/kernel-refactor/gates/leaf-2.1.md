# Gates: leaf-2.1 — 桌面身份单一源 + 品牌 hack 链删除

OWNS: src/desktop-identity.ts, src/main.ts, src/update-manager.ts, src/client.ts, plugins/sidebar/src/client/surfaces/dsh-dom.ts, tests/desktop-identity.test.ts

Scope: 新建 desktop-identity 模块收编 PRODUCT_NAME/appId/repo/title 派生与
assertReleaseIdentity；update-manager 与 main 改为消费该模块；删除 installHeroBranding
MutationObserver 整链与 document.title hack（标题经 bridge getInfo 单源）；
findSettingsButton 探测移出 src/client.ts（迁 sidebar dsh-dom.ts 或改官方 API——裁决见 G4）。

- [ ] G1: 身份模块行为测试——appId dev 后缀、标题 Dev/stable 变体、repo 解析、断言失败路径
  CHECK: bash -lc 'node --test tests/desktop-identity.test.ts && echo IDENTITY-TESTS-OK'
  EXPECT: IDENTITY-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: 清零规格转绿——src 内 repo 字面量/品牌 observer/settings 探测残留为零
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-2.1-identity.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 现有更新链路测试不回归
  CHECK: bash -lc 'node --test tests/update-manager.test.ts && echo UPDATE-REGRESS-OK'
  EXPECT: UPDATE-REGRESS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G4: 两项产品裁决记录——(a) hero 文案链删除的上游文案归属确认；(b) settings 打开路径的最终实现（官方 API 或 dsh-dom 探针）及理由；写入本账并同步 plugins/AGENTS.md 若新增探针
  EVIDENCE: pending
