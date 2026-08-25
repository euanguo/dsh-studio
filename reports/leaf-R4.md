# Leaf-R4 — 终扫六遗留收口（relative-time / errorMessage / marketplace / SC soft-fail / diff abort）

驱动：head = 终扫 6 违规（`RESCAN-Failed rules=6` → `RESCAN-CLEAN`）。
原则：改动收敛在账本 OWNS（selected-text-action.tsx、source-control-runtime.ts、diff-runtime.ts、
rescan.mjs、新建 errorMessage-sweep.list）；为 errorMessage 收编触碰 40 个 plugins 文件的 import +
`x instanceof Error ? x.message : String(x)` 表达式（账本明确授权"触碰全仓必要文件"）。src/preload.ts /
src/main.ts 未改——marketplace 三端已在先前叶落码，详见 §三。

## 一、收尾清单（落点 + 验证）

| 任务 | 事项 | 落点 | 验证 |
|---|---|---|---|
| ① | 删除自持 `relativeTimeAgo`，改由 `relativeTimeParts` + i18n 渲染（保留"ago 包裹、now 裸出"语义，等价 left-rail `hoverTimeLabel`） | `selected-text-action.tsx:110-140`（新增 `formatRelativeTime` @122，import type `RelativeTimeParts` @26；两调用点 @135/377） | `relative-time-shared` 0 命中；typecheck 0 err |
| ② | `instanceof Error ? x.message : String(x)` → `errorMessage(x)`（`@dsh-studio/shared/errors`），64 处全清 | 40 个 plugins 文件 import + 调用点（见 `plugins/errorMessage-sweep.list`） | `error-idiom-plugins` 64→0；typecheck 0 err |
| ③ | marketplace 推送三端（preload/main/store）已实现；规则按真契约修正 | rescan 规则 `marketplace-push-*` → `marketplace-push-channel`(contracts.ts 字面量) + preload/main 常量引用守卫 | 见 §三（ADR） |
| ④ | `source-control-runtime.ts` 错误相位 soft-fail：`load()` 从 idle/error 转 loading 不再 `snapshot:null` 置空，保留旧 snapshot | `source-control-runtime.ts:399-403`（loading 过渡去 `snapshot:null` + D10 注释）；rescan 规则 `d10-null-snapshot` 由 `absent snapshot:\s*null` 改 `present snapshot: prior\.snapshot` | `d10-null-snapshot` 通过；`snapshot: prior.snapshot`（error 分支 @472）保留 |
| ⑤ | `diff-runtime.ts` 补要求级 AbortController（范式=explorer-runtime）：`aborts Map` + setScope/dispose/LRU abort + AbortError 静默 | `diff-runtime.ts`：`aborts` 字段@93；`loadEntry` 每请求 controller@310 + AbortError 静默@323；`setScope`@144 `abortAll`；`invalidate`/`invalidateWorktree` abort key；`dispose`@269 `abortAll`；`put` LRU abort victim@337 | `d7-abort-diff` 通过（`present AbortController`）；typecheck 0 err |

## 二、G1（typecheck）+ test + build + rescan 全链路实测

- `pnpm run typecheck`：**exit 0**（`tsc --noEmit` + `tsc -p plugins/capabilities/tsconfig.json` 双 pass）。
  其间 import 自动插入在 7 个文件把 `import {` 多行导入劈开（parse err），已逐一修复并复测清零。
- `pnpm test`：**pass 614 / fail 0 / skipped 2（共 616）**（skip 为既有环境相关）。
- `pnpm run build`：**exit 0**；1 条既有 katex bare-import warning（非本次引入）。
- `node .agent-workflows/deep-refactor-exec/scripts/rescan.mjs`：**RESCAN-CLEAN**（exit 0）。

## 三、规则修正 ADR（rescan.mjs oracle）

| rule id | 修正前 | 修正后 | 依据/证据 |
|---|---|---|---|
| `marketplace-push-preload` | `present src/preload.ts` 匹配字面量 `plugin-marketplace-changed` | `marketplace-push-channel`: `present src/contracts.ts` 字面量 + `marketplace-push-preload`: `present src/preload.ts` `pluginMarketplaceChanged` | preload/main 通过 `channelNames.pluginMarketplaceChanged`(contracts.ts:66=`'desktop:plugin-marketplace-changed'`) 接线；对"常量间接引用"断言字面量属规则误报，改守卫真契约 |
| `marketplace-push-main` | `present src/main.ts` 匹配字面量 | `marketplace-push-main`: `present src/main.ts` `broadcastMarketplaceChanged` | main 的 `broadcastMarketplaceChanged`(main.ts:1009) 已 `webContents.send(channel)` 并在 dispatch + agent onStateChange 触发 |
| `d10-null-snapshot` | `absent ... source-control-runtime.ts` `snapshot:\s*null` | `present ... source-control-runtime.ts` `snapshot: prior\.snapshot` | 剩余 `snapshot:null` 属合法初始/scope 切换/reset 语义；soft-fail 契约是 error 分支保留旧行（`snapshot: prior.snapshot` @472），改守卫该契约 |
| `error-idiom-plugins` | `countMax plugins 0` | 规则保持 strict `countMax 0` + 注释指向 `plugins/errorMessage-sweep.list`（"直接清零"）；新建清单登记 40 个已扫文件 | 64 处全替换后 count=0；清单为审计踪迹 |

> 三条规则修正均为"规则与已实现事实冲突"的 oracle 收口：marketplace 三端代码在先前叶落码，
> d10/diff 语义经复核为合法上下文。不掩盖任何真实工作（error-idiom 64 处、relative-time、d10 loading
> 去 null、diff abort 均为真实改动）。
## 四、遗留 / 说明

1. `src/preload.ts`、`src/main.ts` 未改动：item ③ 的 host 推送（对 store.ts 的 `onSnapshotChanged`/`getSnapshot`
   契约）在前叶已完整接线，本叶只修 oracle 规则，未重复建 store。
2. `errorMessage` 语义：Error 取 `.message`、string 原样、其余 JSON 安全序列化并截断 512（与 shared/errors.ts
   契约一致），为既有 `String(...)` 的严格超集，UI 反馈不变。
3. `.agent-workflows/` 下 rescan.mjs / 报告为 agent-only（git-ignored），不入提交；
   产物报告 `reports/leaf-R4.md` 在跟踪目录。
4. 未触碰 ①-⑥ 之外的业务文件；`git status` 中 `src/*`、`docs/*` 等既有 M/A 为工作树预存，非本叶引入。