# Leaf-R3 — 收尾：typecheck 清零 / 四能力恢复 / git.upstream 接线 / sidebar 断言修正

驱动：HEAD = `83cc4d1`。原则：恢复项从 `git show HEAD:<path>` 只读提取并加 `// unwired-capability:` 注释；
零调用 ≠ 冗余。未做任何 git 写 / install / test / build（仅 `pnpm run typecheck`、`node --test`、`rescan.mjs`）。
改动主角为账本指定的 ①-④ 清单；为满足 wire-contract 契约守卫（②的 git.upstream 闭环）追加
`routes/git.ts` host handler（其他叶给定的 d19-orphan-dto/handler 无额外违规，见 §三）。

## 一、收尾清单（落点 file:line + 验证）

| 任务 | 事项 | 落点 | 验证输出 |
|---|---|---|---|
| ① | M6 派生 schema zod 修复：`jsonField: any`（Head 即 `any`，去掉 `z.ZodType` 命名空间）；enum nullable 用 `'nullable' in field` 收窄 | `ui-chrome-domain.ts:28,55` | typecheck 前 `Cannot find namespace 'z'`(28,18) + `Property 'nullable'`(55,21) 共 2 err → 清零 |
| ② | 恢复 `defaultShell`（pty-manager，HEAD 兼容包装，注入 thunk 取代后未接线）+ import `resolveShell/ShellResolutionOptions` | `pty-manager.ts:405`（import@15，unwired@400） | 全仓 0 引用，unwired；typecheck 0 err |
| ② | 恢复 `sanitizePersistedTerminalHistory`（terminal-history-sanitizer，单项历史消毒） | `terminal-history-sanitizer.ts:247`（unwired@242） | 全仓 0 引用，unwired；typecheck 0 err |
| ② | 恢复 `worktreeSessionPathOf`（worktree-orchestration，session cwd 投影） | `worktree-orchestration.ts:570`（unwired@565） | 全仓 0 引用，unwired；typecheck 0 err |
| ② | 恢复 `encodeHtmlUrl`（html-route，保留 W 已修 decode + 文档尾部说明） | `html-route.ts:42`（unwired@37） | 全仓 0 引用，unwired；typecheck 0 err |
| ③ | `git.upstream` DTO 条目（HEAD 签名 `Record<string, never>`） | `capabilities-api.ts:234` | wire-contract 前 fail（`['git.upstream']`）→ pass |
| ③ | `git.upstream` host handler（HEAD 签名 `git.readUpstreamStatus`；`readUpstreamStatus` 在 git-core.ts:783 仍存在） | `routes/git.ts:169` | wire-contract pass；typecheck 0 err |
| ③ | sidebar-api `gitUpstream` 包装（HEAD 签名）+ `CapabilitiesGitUpstreamStatus` 类型导入 | `sidebar-api.ts:142`（import@20） | typecheck 0 err |
| ④ | sidebar.test `storage.writes.length` 1→3：R1 persistVia 拉模型下每 mutator 各自 `fire`（openTab→writeTarget、setWidth、setOpenByDefault 共 3 写）；保持「有界布局持久化」意图，未回退 persistVia | `tests/sidebar.test.ts:279-284` | 期望 1→实 3，修正后 pass |

## 二、G1–G4 自评

- **G1 typecheck 清零**：`pnpm run typecheck` exit 0（主 tsc + capabilities tsconfig 双 pass）。R2 遗留的
  `ui-chrome-domain.ts`(28,18)/(55,21) 两 err 已消；恢复的 4 函数 + git.upstream 三侧均 0 err。
- **G2 四能力恢复 + unwired**：✅ defaultShell / sanitizePersistedTerminalHistory / worktreeSessionPathOf /
  encodeHtmlUrl 全部从 HEAD 取回并带 `// unwired-capability:`；四者当前调用点 0（确实未接线，注释成立）。
- **G3 git.upstream 三侧闭环**：DTO(capabilities-api) + host handler(routes/git) + client 包装(sidebar-api)
  均复现 HEAD 签名；wire-contract 守卫（DTO↔route 双向对齐）由 fail→pass，证明接线完整。保留既有
  `upstream` 派生数据（routes/git.ts 内 status 用的 upstream 变量）未动。
- **G4 sidebar 断言修正（勿回退 persistVia）**：不触碰 sidebar-service/storage/persistVia，仅按新拉模型
  计数语义改断言 1→3，`value.workspaces['/work/repo']` width=512、tabs.len=1、openByDefault 等意图断言全部保留。

## 三、typecheck / test / rescan 输出摘要

- `pnpm run typecheck`：**exit 0**（`tsc --noEmit` + `tsc -p plugins/capabilities/tsconfig.json` 均通过）。
- `pnpm test`（`node --test tests/*.test.ts`）：**pass 613 / fail 1 / skipped 2（共 616）**。
  唯一 fail 为 `tests/desktop-env-guard.test.ts:87`「scrub 模块确定性生成/幂等写」：`ensureEnvScrubModule`
  现写 `root/cache/dsh-studio-env-scrub.cjs`（`env-scrub.ts` 预存 `SCRUB_CACHE_DIR='cache'`），测试仍期望
  `root/dsh-studio-env-scrub.cjs`。**非本叶引入**（env-scrub.ts / desktop-env-guard.test.ts 均不在本叶改动，
  `git status` 起始即 `M src/env-scrub.ts`）；不在 ①-④ 授权清单，故不擅自修，如实上报。
- rescan `--stage w1`：**`RESCAN-CLEAN`**（R2 的 15 项其它叶违规不属 w1 门禁；本叶新增 0 违规）。

## 四、遗留 / 说明

1. `routes/git.ts:169` 不在 ①-④ 显式文件名中，但为 git.upstream 能力闭环 + `capabilities-wire-contract`
   契约守卫（DTO key ⇒ host route）所必需；否则本叶引入新违规、`pnpm test` 红，故追加。
2. `desktop-env-guard.test.ts` fail：见 §三，为工作树预存不一致（env-scrub `cache/` 落地 vs 测试旧路径），
   非本叶能力。若需修，应同步 `src/env-scrub.ts` 与测试（不在本叶范围）。
3. 无效导出纪律：4 个 unwired 函数确为「零调用」，与 R2 对 rd8-zero-call-fns 的 UNWIRED_ALLOWLIST 判断一致
   （恢复"实际可用但前端未接线"）。