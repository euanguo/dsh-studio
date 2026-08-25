# Gates: leaf-3.1 — 市场事务显式相位机

OWNS: plugins/plugin-marketplace/src/host/transaction-manager.ts, tests/marketplace-phases.test.ts

Scope: #busy/#active/#plan/#candidate/#rollback 五散布字段收敛为显式 Phase 枚举
（idle→catalog-ready→planning→previewing→applying→applied-with-undo→undoing，正交 busy）+
每命令守卫表（调研 D 表3）；外部快照 DTO 与 wire 行为不变；本叶不改磁盘时序（leaf-3.2 做）。

- [ ] G1: 守卫矩阵行为测试——命令×相位 accept/reject 全表断言（含 MarketplaceBusyError 唯一抛点语义、inspect 拒 active≠null、preview 服务端 confirmations 校验点保持、apply 拒非 previewing、undo 拒非 applied-with-undo）
  CHECK: bash -lc 'node --test tests/marketplace-phases.test.ts && echo PHASES-TESTS-OK'
  EXPECT: PHASES-TESTS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: wire 兼容回归——既有市场测试全绿（快照 DTO/命令面零变化）
  CHECK: bash -lc 'ls tests/plugin-*.test.ts tests/capabilities-wire-contract.test.ts 2>/dev/null | xargs node --test && echo PHASES-WIRE-OK'
  EXPECT: PHASES-WIRE-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 无兼容层自查——五个旧私有字段不得以平行布尔形式残留（字段突变矩阵复核记录）；prepare 自动级联 preview 的隐式边界改为显式相位转移
  EVIDENCE: pending
