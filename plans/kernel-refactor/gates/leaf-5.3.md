# Gates: leaf-5.3 — guards 接线扩展

OWNS: scripts/guards/**, package.json, .github/workflows/ci.yml

Scope: check:guards 链挂入 guard-dsh-dependencies（4.1 产物）与前轮 rescan 中有价值的局部
规则内迁（abort 三件套/arbiter/wholestore-subscribe——按可低误报实现为准，不可静态化的
留 spec 人工评审并在 README 记录放弃理由）；CI core job 增加 check:guards 步骤。

- [ ] G1: 扩展链全绿
  CHECK: bash -lc 'pnpm run check:guards >/tmp/kr-53.log 2>&1 && echo GUARDS-CHAIN-EXTENDED-OK'
  EXPECT: GUARDS-CHAIN-EXTENDED-OK
  CWD: .
  EVIDENCE: pending

- [ ] G2: CI 接线在场——core job 含 check:guards 步骤且语法有效（yaml 解析通过）
  CHECK: bash -lc 'grep -q "check:guards" .github/workflows/ci.yml && node -e "const y=require('fs').readFileSync(\".github/workflows/ci.yml\",\"utf8\")" && echo CI-GUARDS-OK'
  EXPECT: CI-GUARDS-OK
  CWD: .
  EVIDENCE: pending

- [ ] G3: 放弃清单人工确认——未静态化的军规项逐条写明误报理由与人工评审归属（写入 scripts/guards/README.md）
  EVIDENCE: pending
