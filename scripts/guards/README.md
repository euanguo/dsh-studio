# scripts/guards — 防再犯守护（CI / 预提交）

本目录承载把「全仓收敛重构」确立的约定固化为可执行守则的 Node 守护脚本。
每个脚本约定同一套输出契约：打印违规清单（`file:line` + 规则名）后 `exit 1`；
全净时打印 `GUARD-OK` 并 `exit 0`。供 CI 与预提交钩子调用
（`pnpm run check:guards`）。

| 脚本 | 守护规则 | 说明 |
| --- | --- | --- |
| `guard-no-localstorage.mjs` | S2 持久化 | 扫描 `plugins/*/src/client/**`，禁止组件直接读写 `localStorage`/`sessionStorage`。白名单：`plugins/shared/comments-migration.ts`（legacy 只读迁移）、`plugins/sidebar/src/client/kit/keymap.ts`（leaf-R1 ③ 恢复的 override 持久化半）。 |
| `guard-no-inline-probe.mjs` | S4 上游探针 | 扫描 sidebar / marketplace / left-rail 三个 feature client 树，上游 DOM 探针（`[data-slot="conversation"/"sidebar"]`、`[class*=`/`[aria-*=`）只能出现在各插件唯一探针模块与生成物（`dsh-dom.ts`、`marketplace-dom.ts`、`skin-dom.ts`、`generated-selectors.ts`、`styles.ts`、`chunk-loader.ts`）。查询自有 `data-slot`（如 `surface-tab`、`[data-line]`）不算违规。 |
| `guard-dead-exports.mjs` | 死导出告警 | 提取 `@dsh-studio/shared` 命名导出，全仓词边界计数，外部引用 ≤1 的告警（警告模式 `exit 0`）；`--strict` 下非白名单者 `exit 1`。白名单 `.unlazy/dead-export-allowlist.json`。 |

## 运行

```sh
pnpm run check:guards            # 三个守卫全部要求 GUARD-OK
node scripts/guards/guard-dead-exports.mjs --strict   # 死导出严格模式
```

## rescan.mjs（RG5 终扫 oracle）

`rescan.mjs` 位于 `.agent-workflows/deep-refactor-exec/scripts/rescan.mjs`，
是当初「重扫一次应找不到本轮任何问题」的终扫守护（ROOT RG6 的 oracle），
逐条断言 wave1–wave5 的 absent/present/countMax 规则。本目录通过薄封装暴露其
CLI，供从仓库根独立调用：

```sh
node scripts/guards/rescan-shim.mjs [--stage final|w1|w2|w3|w4|w5]
```

薄封装仅透传参数并委托 `.agent-workflows/deep-refactor-exec/scripts/rescan.mjs`，
因为该脚本以 `process.cwd()` 解析仓库根，不能在自己的目录里裸跑。它打印
`RESCAN-CLEAN`（退出 0）或违规清单（退出 1），与三只守卫一起构成 `--stage
final` 的完整防再犯门。注意 `rescan.mjs` 与守卫按同一批 rescan `UNWIRED_ALLOWLIST`
共享豁免语义（如 keymap.ts 的 localStorage 半），不要在这些脚本间复制豁免表。