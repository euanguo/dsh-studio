# kernel-refactor — 执行包（unlazy orchestrated mode 输入）

本目录是 DSH Studio **结构轮一次性完整重构**的执行计划包。它由纯计划阶段产出，
本身不包含任何产品代码改动；执行时按 unlazy orchestrated mode 驱动。

本包已与近期提交 `7514a69`、`674392f`、`5928e82`、`05f6543`、`377d0b1`、
`1b75b96`、`1c88b8d`、`7595452`、`9efaadf` 对账。执行时把这些提交视为 baseline：
不得重复实现 comments-record、strict hydration、GitWatch、marketplace push token、
ui-chrome recursive schema 或 sidebar width policy。

## 包结构

```text
plans/kernel-refactor/
├── README.md            ← 本文件：执行入口
├── target-design.md     ← 目标架构基准（五轨道最终形态 + 硬约束 + 迁移语义）
├── PLAN.md              ← 契约清单 O1-O21 / 深度树 / Needs / OWNS / 波次 / 裁决记录
├── GATES.md             ← ROOT 终局账（RG0-RG8）
├── gates/
│   ├── leaf-*.md        ← 22 个叶子台账（每个叶子独立完成契约）
│   └── node-*.md        ← 5 个分支集成账
├── legacy-specs/*.json  ← 13 份清零规格（无增容层军规的机器 oracle）
└── scripts/
    ├── check-absent.mjs      ← 清零探测器（含 --self-test 正控）
    └── lint-package.mjs      ← 全包台账 lint
```

## 硬约束（先读）

1. **无增容层军规**（用户修订，最高优先级）：禁止兼容层/中间层/re-export shim/deprecated
   别名/双读双写代码通道。每叶子 = 新 API + 消费方直迁 + 旧路径删除 + 测试重写。
   用户数据格式迁移例外（幂等、非破坏、重启安全）。
2. 并发叶禁止运行 pnpm typecheck/test/build 或安装依赖——全局门禁由驱动者在波间执行。
3. 不做 git commit；完成后统一请示。commit 规范 `<module>: <subject>` + DCO。

## Kickoff 步骤（驱动者执行）

```bash
# 0. 自检工具链与基线（应全绿）
node plans/kernel-refactor/scripts/check-absent.mjs --self-test   # SELFTEST-OK
pnpm run typecheck && pnpm test && pnpm run build                 # 三连绿
node plans/kernel-refactor/scripts/lint-package.mjs               # PACKAGE-LINT-OK

# 1. 记录每份清零规格的真实基线（已落地的 baseline 项允许为绿，
#    其余遗留项应为红；不要把“全红”当作成功条件）
for f in plans/kernel-refactor/legacy-specs/*.json; do
  node plans/kernel-refactor/scripts/check-absent.mjs --spec "$f" >/tmp/kernel-refactor-spec.out 2>&1
  code=$?
  printf '%s exit=%s %s\n' "$(basename "$f")" "$code" "$(head -1 /tmp/kernel-refactor-spec.out)"
done

# 2. 台账以本包为唯一事实源（不要复制到 .unlazy，避免双源漂移）；
#    unlazy 运行态（dispatch.json/status.log/locks）照常落在：
#    .unlazy/kernel-refactor/   （dispatch-check 自动创建）

# 3. 按 PLAN.md 波次表开波。验证一律显式给台账路径并锚定仓库根：
node /Users/verger/.agents/skills/unlazy/scripts/gate-check.mjs \
  --root . --cwd . --reverify plans/kernel-refactor/gates/leaf-4.1.md
# 首次运行会打印待批准 oracle；审阅后 --approve 同一路径再跑。

# 4. 波间全局门禁（驱动者）：pnpm run typecheck / test / build / check:guards
# 5. 分支完成后跑对应 node-*.md；全部完成进 ROOT GATES.md 复测 RG0-RG8。
```

## 叶子 → 波次速查

| Wave | Leaves |
|---|---|
| W1 | leaf-4.1 · leaf-2.1 · leaf-3.1 · leaf-4.3 |
| W2 | leaf-1.1 · leaf-2.2 · leaf-3.2 |
| W3 | leaf-1.2 · leaf-2.3 |
| W4 | leaf-1.4 · leaf-2.4 · leaf-3.3 |
| W5 | leaf-1.3 · leaf-1.5 |
| W6 | leaf-1.6 · leaf-2.5 · leaf-5.1 |
| W7 | leaf-1.7 |
| W8 | leaf-5.2 → leaf-5.3 → leaf-5.4（终稿） |
| 终局 | node-1..node-5 → ROOT |

依赖细节与 OWNS 全表见 [PLAN.md](PLAN.md)；架构依据见 [target-design.md](target-design.md)。

## 完成定义

ROOT RG0-RG7 全部 runnable 绿 + RG8 人工对账签收；13 份清零规格全绿；
PLAN 契约清单 O1-O21 每行有 VERIFIED owner；近期 baseline 保护项在分支账中有回归证据；
无 ABANDON 遗留（若出现，按 unlazy 规则作为 HANDOFF REQUIRED 显式交接，不算完成）。
