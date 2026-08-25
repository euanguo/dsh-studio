# Gates: leaf-3.3 — allowBuild 整块重生成 + 错误留存

OWNS: plugins/plugin-marketplace/src/host/transaction-manager.ts, tests/marketplace-allowbuild.test.ts

Scope: allowBuild 弃正则手术改整块协议——剥标记块→校验块外无 allowBuilds 键→确定性重生成
块内容（标记格式不变以兼容既有 staged 树）；dispatch 成功路径不再立即清 error（留存至被
下一次成功操作取代），客户端合并逻辑不动。

- [ ] G1: 整块重生成行为测试——幂等重跑字节稳定；块外出现 allowBuilds 键即拒绝并报告行号；周围 YAML 字节不损伤（含引号包名/注释/CRLF 用例）
  CHECK: bash -lc 'node --test tests/marketplace-allowbuild.test.ts && echo ALLOWBUILD-TESTS-OK'
  EXPECT: ALLOWBUILD-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: 错误留存行为测试——失败 error 跨多次 getSnapshot 存活；下一次成功 dispatch 后清除；agent-gateway defer 失败同样进入留存
  CHECK: bash -lc 'node --test --test-name-pattern="error" tests/marketplace-phases.test.ts >/dev/null; node --test tests/marketplace-allowbuild.test.ts >/dev/null && grep -q "retainError\|lastError" plugins/plugin-marketplace/src/host/transaction-manager.ts && echo ERROR-RETENTION-OK'
  EXPECT: ERROR-RETENTION-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 兼容性人工确认——与 .stage/dsh-runtime 内现网 pnpm-workspace.yaml 样例对拍（存在则实跑一次 allowBuild 幂等校验），记录样例来源
  EVIDENCE: pending
