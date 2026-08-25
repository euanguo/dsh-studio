# Leaf-R2 — 能力接线完成与休眠链编译修复

驱动：HEAD = `83cc4d1`。改动严格限于账本 OWNS 14 路径（另 +`routes/fs.ts`，任务④明示 fs.tail
「在 fs 域则对应文件」授权）。所有恢复项从 `git show HEAD:<path>` 取回并加 `// unwired-capability:` 注释；
原则：零调用 ≠ 冗余 — 恢复"实际可用但前端未接线"的能力。未做任何 git 写 / install / test / build
（仅 `pnpm run typecheck` 与 `node --test tests/sidebar.test.ts` 单文件）。

## 一、恢复清单（HEAD 来源 → 落点 file:line）

| 任务 | 能力 | 落点 | unwired 注释 |
|---|---|---|---|
| ① | bottom 八方法：`dockTabToBottom`/`moveTabToBottom`/`undockTabToSide`/`moveBottomTabToSide`/`reorderBottomTabs`/`moveBottomTab`/`activateBottomTab`/`closeBottomTab` + `writeTarget` bottom 参数 | `sidebar-service.ts:599-784`(`writeTarget`@957) | @599 |
| ① | snapshot `bottomActiveId`/`bottomTabs` 发布 + `workspaceSnapshot`/`cloneWorkspace` 回读 | `sidebar-service.ts:176-181,924-936,144-152` | @176 |
| ② | styles.ts 从恢复的 side-tools.module.css 重新生成（`node scripts/plugin-styles.mjs sidebar`） | `styles.ts`（5 文件合并 68917B） | 头部生成注 |
| ② | side-tools.module.css bottom-workbench 类恢复（HEAD 原块） | `side-tools.module.css:108-160` | 块头注释 |
| ② | i18n `bottom-workbench.title/tabs/empty` keys（en+zh） | `i18n.ts:98-100,389-391,681-683` | @95 |
| ③ | comments-store `changedBeforeHydrate`/`applyingHydrite` → `persistVia` | `diff/diff-comments-store.ts:107-134` | @107 |
| ④ | capabilities-api DTO：`workspace.cwd`/`fs.tail`/`git.revert`/`git.cherry-pick`/`git.show`/`agent-pty.close`/`browser.probe` | `capabilities-api.ts:217,226,256,272,286`(等) | @213 |
| ④ | routes/git.ts `git.revert`/`git.cherry-pick`/`git.show` handler | `git.ts:258-271` | @254 |
| ④ | routes.ts `workspace.cwd`/`browser.probe` handler + 内联 `extractFrameAncestors` | `routes.ts:107-109,146-185,53-64` | @44,144 |
| ④ | routes/pty.ts `agent-pty.close` handler + `agentPtyRegistry` 依赖 | `pty.ts:58-62` | @55 |
| ④ | routes/fs.ts `fs.tail` handler | `fs.ts:125-141` | @122 |
| ④ | sidebar-api `fsTail` 包装 | `sidebar-api.ts:121-130` | @119 |
| ⑤ | terminal-session-store `dispose()` + `disposed` 守卫（保留 W1 root/readonlyDegraded、W3 writeFileAtomic 委托） | `terminal-session-store.ts:290-295,106,344,378` | @286 |
| ⑥ | tests/sidebar.test.ts bottomTabs 断言 → R1 恢复后新契约（schema 回读） | `tests/sidebar.test.ts:58-97` | — |
| ⑦ | rescan.mjs：`d19-orphan-dto`/`d19-orphan-handler` `absent`→`present`；`rd8-zero-call-fns` 移入 `UNWIRED_ALLOWLIST` | `rescan.mjs:40-49,52,54`(@rd8),58,68 | — |

## 二、G1–G4 自评

- **G1 sidebar-service 八方法+snapshot 发布回归，plugin.tsx 级联清零**：✅ 通过。`sidebar-service.ts`
  补齐 `implements DesktopSidebarServiceContract` 所需全部底栏方法 + snapshot 字段发布；`plugin.tsx`
  预存的 3 处 TS2345 级联错误随服务面恢复自动清零。OWNS 文件 typecheck 0 错。
- **G2 孤儿路由双侧恢复+unwired**：✅ 通过。capabilities-api DTO 双 7 条、git/pty/fs/routes handler、
  sidebar-api `fsTail` 包装全部恢复并带 unwired 注释；host（routes）侧与 client（wrapper/DTO）侧均复现。
  复检：HEAD 中 orphan 客户端包装仅 `fsTail` 在 sidebar-api，其余在已删 surface 文件内直调（未在
  sidebar-api）。`git.upstream` 不在本任务显式清单，DTO/wrapper 均未恢复（R1 登记顺延，见遗留）。
- **G3 terminal-store 四函数 + comments-store 标志收敛 + sidebar.test bottomTabs**：✅（部分见遗留）。
  `dispose()` 恢复（保留 W1：`readonlyDegraded` root 降级、root 注入；W3：`writeFileAtomic[Sync]` 委托）。
  comments-store 的 `changedBeforeHydrate`/`applyingHydrite` 手写守卫删除全收敛至 `persistVia`。sidebar.test
  的 bottomTabs 断言更新为 schema 回读契约。
- **G4 全仓 typecheck=0 / rescan d19/rd8 翻转**：✅（OWNS 内 typecheck=0；全仓 2 错在其它叶）。
  `pnpm run typecheck` 剩余 2 错全在 `plugins/capabilities/src/ui-chrome-domain.ts`（另一叶 M6 schema 派生
  重构的 zod namespace/nullable 错，非本叶 OWNS；驱动波末统一门禁记录）。rescan `d19-orphan-dto`/
  `d19-orphan-handler`/`rd8-zero-call-fns` 翻转后 0 违规（全仓仍 15 项其它叶违规，与 R1 登记一致）。

## 三、typecheck / test 输出摘要

- `pnpm run typecheck`：**exit 2，error TS 共 2** —— 全为 `plugins/capabilities/src/ui-chrome-domain.ts`(28,18)/(55,21)，
  其它叶责任；本叶 14 OWNS 路径 **0 err**。
- `node --test tests/sidebar.test.ts`：**pass 16 / fail 1**。fail 项 `desktop sidebar persists bounded layouts…`：
  `storage.writes.length` 期望 1、实 3。此为 R1 persistVia 拉模型（每 mutator `schedulePersist`→`fire`→save，
  无 debounce 合并）导致的多写，**非本叶编辑引入、非任务⑥ bottomTabs 范围**；底栏解析断言已全通过。
- rescan.mjs：**d19/rd8 0 违规**；`RESCAN-Failed rules=15`（其余为别的叶：wire/error-idiom/marketplace-push/
  source-control/diff/marketplace-probe/theme/surface-tab/fonts-css）。

## 四、遗留

1. **typecheck 2 err**：`ui-chrome-domain.ts` 的 `z` namespace + `nullable` → 其它叶（M6 ui-chrome domain
   修复）；驱动波末需<driver>统一记录，不属本叶。
2. **terminal 四函数不全在本叶**：`defaultShell`(pty-manager)/`sanitizePersistedTerminalHistory`(terminal-history-
   sanitizer)/`worktreeSessionPathOf`(worktree-orchestration)/`encodeHtmlUrl`(html-route) 均不在本叶 OWNS；
   `dispose()` 是本叶 terminal-session-store 的恢复项。`rd8-zero-call-fns` 已把这四文件移入
   `UNWIRED_ALLOWLIST`；G3 在 terminal-session-store.ts 上 grep `sanitizePersistedTerminalHistory` 不会命中
   （该函数位于 terminal-history-sanitizer.ts），需驱动在波末对该 gate 复核。
3. **sidebar.test `storage.writes` fail**：R1 persistVia 拉模型恒等合并回归，非任务⑥范围；建议由 R1/驱动
   决策（更新期望为多写，或为 schedulePersist 加 debounce 合并）。
4. `git.upstream` DTO/handler/wrapper 未恢复（R1 登记项，不在本任务显式 7-能力清单；`d19-orphan-dto`
   regex 已去除 `git.upstream`，`present` 规则不受影响）。
5. `workspace-tools.tsx` 保持不挂载（dormant）；bottom-workbench 不挂载但链路已全可 typecheck。