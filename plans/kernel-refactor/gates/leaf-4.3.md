# Gates: leaf-4.3 — 上游 independent-columns 提案包

OWNS: docs/upstream/independent-columns-proposal.md

Scope: 把 verify-staged-layout.mjs 已固化的 patch 行为契约（列宽 clamp 区间、无 center
地板、禁 auto-collapse）翻译为上游可接受的提案文档：动机、行为规格、上游测试映射、
配置面草案、PR 大纲。本叶不改任何树内行为；patches/*.patch 存续至上游接受（显式交接）。

- [x] G1: 提案包人工审阅——含上述五节；每条行为规格都能指回 verify-staged-layout 的断言行号；由驱动者之外的第三人复核签名
  EVIDENCE: ox-alpha independent review PASS; all five sections and all verifier line citations checked against docs/upstream/independent-columns-proposal.md and scripts/verify-staged-layout.mjs; minor non-blocking flags recorded in review report.

- [x] G2: 树内验收契约仍然成立——staged 布局校验在最近一次 stage:dsh 产物上通过（若 .stage 不在则引用最近 CI/runtime job 绿色记录）
  EVIDENCE: node scripts/verify-staged-layout.mjs .stage/dsh-runtime exited 0 with "Verified staged DSH layout interactions"; independent reviewer reran the same check.
