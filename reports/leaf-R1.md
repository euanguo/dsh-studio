# Leaf-R1 — 未接线能力恢复（revision 4 用户修正）

驱动：HEAD = `83cc4d1`（重构前的最近提交）；整个 deep-refactor 是本工作树未提交的改动。
所有恢复项均从 `git show HEAD:<path>` 取回并加 `// unwired-capability:` 注释。
原则：零调用 ≠ 冗余 — 恢复"实际可用但前端未接线"的能力，仅保留删除真正重复实现/死包装。

## 一、恢复清单（HEAD 提取来源 → 落点 file:line）

| 能力 | HEAD 来源 | 落点 | unwired 注释 |
|---|---|---|---|
| composer: input-history | `plugins/sidebar/src/client/input-history.ts` → `plugins/sidebar/src/client/input-history.ts:1` | `InputHistory` class @35 | 文件头 @4 |
| composer: input-history 聚合 | `.../composer-input-history.ts` → `.../composer-input-history.ts:1` | `ComposerInputHistory` @96, `submittedInputEntries` @52 | 文件头 @4 |
| composer: 写路径桥 | `.../composer-history-bridge.ts` → `.../composer-history-bridge.ts:1` | `hasOpenComposerTriggerMenu` @30, `composerInputForSession` @44 | @1 |
| composer: 方向键映射 | `.../composer-history-keyboard.ts` → `.../composer-history-keyboard.ts:1` | `historyDirectionForKey` @21, `isAtHistoryBoundary` @29 | @1 |
| composer 测试 ×4 | `tests/{input-history,composer-input-history,composer-history-bridge,composer-history-keyboard}.test.ts`（HEAD 还原，与 HEAD 逐字节一致） | `tests/*.test.ts` | —（纯行为测试）|
| bottom-workbench | `.../bottom-workbench.tsx` → `.../bottom-workbench.tsx:1` | `BottomWorkbench` @58（dormant，不挂载）| ADR 头 @15 |
| side-tabs bottom 分支 | `.../side-tabs.tsx`（`payload.source==='bottom'` → `undockTabToSide`）| `.../side-tabs.tsx:112` | @109 |
| contract 底栏字段 | `.../contract.ts`（`SidebarSnapshot.bottomActiveId/bottomTabs`）| `.../contract.ts:108,110` | @106 |
| contract 底栏方法 | `.../contract.ts`（drag-layout 方法集）| `.../contract.ts:412,425,440-450` | @407 |
| sidebar-preferences bottomTabs schema | `.../sidebar-preferences.ts`（`PersistedWorkspaceLayout` + `parseWorkspace`）| `.../sidebar-preferences.ts:54-56,183-199` | @40,180 |
| keymap 持久化半 | `.../kit/keymap.ts`（`readKeymapOverrides`/`writeKeymapOverride`+localStorage）| `.../kit/keymap.ts:147-171,184-197` | @9-16,146 |
| git-core revert/cherryPick/show | `.../shared/git/git-core.ts` | `show` @638, `revert` @904, `cherryPick` @909 | @631,901 |
| stable-pane-id legacy 解析 | `.../shared/stable-pane-id.ts`（已在 HEAD，未在本次被改）| `parseLegacyNumericPaneKey` @62 | 源文件已含，无需改 |
| stable-pane-id 测试同步 | `tests/stable-pane-id.test.ts`（已在 HEAD，未改）| 4 断言全保留 | — |

稳定：`plugins/shared/stable-pane-id.ts` 与 `tests/stable-pane-id.test.ts` 在本工作树 == HEAD，
`parseLegacyNumericPaneKey` 已存在且测试断言齐整 → **任务⑤已满足，无需改动**；该测试不在 OWNS，
按要求登记：无需同步。

## 二、G1–G4 自评

- **G1 composer 四件套+测试回归**：✅ 通过。四源文件+四测试已从 HEAD 还原，每个入口带
  `unwired-capability` 注释；import 路径无需适配（目录未变）。测试文件与 HEAD 逐字节一致。
- **G2 bottom-workbench 链路回归 + dormant/unwired ADR**：✅ 通过。`bottom-workbench.tsx` 已还原并带头部
  ADR（`// unwired-capability ... 待产品决策`）；保持 workspace-tools **不挂载=dormant**（未恢复
  mountBottomWorkbench 调用）；contract 底栏字段、side-tabs bottom 分支、preferences bottomTabs 解析均回归。
- **G3 keymap 持久化半 / git-core 三导出 / stable-pane-id legacy 解析**：✅ 通过。`readKeymapOverrides`/
  `writeKeymapOverride`+localStorage（保留 W1 进程缓存 `actions` Map，覆写优先）；git-core
  `show`/`revert`/`cherryPick` 恢复 HEAD 签名；`parseLegacyNumericPaneKey` 已在位。
- **G4 人工复核**：⚠️ 部分通过（见下）。每个恢复入口均带 `unwired-capability` 注释；rescan 已翻转。

### typecheck 复核（G4）
`node_modules/.bin/tsc --noEmit -p tsconfig.json` 全仓仅 14 错，全部集中在**刻意顺延/跨租约**的
dormant 链上，OWNS 自包含恢复项**零错误**：

| 错误分类 | 文件 | 归属 |
|---|---|---|
| CSS 类名缺失 TS7053 | `bottom-workbench.tsx` ×5 | 需重生成 `styles.ts`（来自 `side-tools.module.css`），二者均**不在 OWNS** |
| i18n key 缺失 TS2345 | `bottom-workbench.tsx` ×3 | `i18n.ts` 的 `WorkspaceMessage` 缺 bottom-workbench 键，**不在 OWNS** |
| 服务实现不满足契约 TS2420/TS2739/TS2345 | `sidebar-service.ts` ×3, `plugin.tsx` ×3 | **sidebar-service 8 方法恢复顺延 R2**（3.1 租约）→ R2 待办 |

确认：composer 四文件+测试、`keymap.ts`、`git-core.ts`、`stable-pane-id.ts`、`contract.ts`（字段/方法本体）、
`side-tabs.tsx`（bottom 分支）、`sidebar-preferences.ts` 均**零错误**。14 错全部归因于 dormant 链的
跨租约兄弟件（styles.ts、i18n.ts、sidebar-service.ts），`禁改其他文件` 下无法在本叶消除，登记为 R2 依赖。

## 三、rescan.mjs 规则变更说明（任务⑥）

`rescan.mjs` 新增 `FILE_PRESENCE` 表 + `UNWIRED_ALLOWLIST` 文件级豁免机制，并翻转本次**实际已恢复**
能力的规则；纯重复实现类规则**保留 absent**。

- `rd5-composer-1..4`（FILE_ABSENCE）→ 移入 `FILE_PRESENCE`（文件必须保留）。
- `f8-bottom-comp`（FILE_ABSENCE）→ 移入 `FILE_PRESENCE`（bottom-workbench.tsx 必须保留）。
- `f8-bottom-refs`（`absentDir`）→ `presentDir` `plugins/sidebar/src/client`（要求底栏引用存在）。
- `q9-keymap-ls`（`absent`）→ `present`（要求 read/write override 持久化半保留）。
- `f2-sidebar-localstorage`（`absentDir`）→ 通过 `UNWIRED_ALLOWLIST` 豁免 `kit/keymap.ts`
  （localStorage 持久化半），豁免文件带 `unwired-capability` 注释。
- **未翻转**（保持 absent/countMax）：`d19-orphan-dto/handler`、`rd8-zero-call-fns`、`rd6-positioning`、
  `rd6-status`、`rd2-icons`、`rd3-card`、`rd13-skeleton/separator`、`c22-panel-mutations` — 这些能力
  **不在 leaf-R1 恢复清单**（git 孤儿路由 DTO/握手 + 终端 4 函数 → R2；positioning/status/icons/card/
  skeleton 视为纯冗余/不在本叶清单）。若后续波次恢复它们，需同步再把对应规则移到 present/白名单。

跑通验证：`node rescan.mjs` 对本次触摸的规则（rd5-*, f8-*, q9-*, f2-*）全部通过；剩余 17 违规均在
其他叶子文件（wire 信封、error-idiom、css 字号、marketplace-push、c16-context 等），非本叶改动引入。

## 四、R2 待办（报告登记 — 顺延项）

1. **capabilities-api 孤儿路由 + DTO + sidebar-api 包装恢复**：git.revert/cherryPick/show、browser.probe、
   agent-pty.close、workspace.cwd、fs.tail、git.upstream 的 handler/DTO/客户端包装（`d19-*`、`rd8-*`
   规则届时同步翻转/豁免）。
2. **terminal-session-store 四函数**：`defaultShell`、`worktreeSessionPathOf`、`sanitizePersistedTerminalHistory`、
   `encodeHtmlUrl`（`rd8-zero-call-fns` countMax 届时处理）。
3. **sidebar-service 八方法**（3.1 租约顺延）：`moveTabToBottom`/`dockTabToBottom`/`moveBottomTabToSide`/
   `undockTabToSide`/`moveBottomTab`/`reorderBottomTabs`/`activateBottomTab`/`closeBottomTab`；并补
   snapshot `bottomActiveId`/`bottomTabs` 发布。R2 补齐后 `sidebar-service.ts`(TS2420/TS2739) 与
   `plugin.tsx`(TS2345) 即恢复。
4. **bottom-workbench dormant 链兄弟件**（使 `bottom-workbench.tsx` 完全 typecheck）：`styles.ts` 重新生成
   （自 `side-tools.module.css` 恢复的 bottom-workbench 类）+ `i18n.ts` 补 `bottom-workbench.*` 键。

## 五、收尾

所有改动严格限于 OWNS 18 路径；`git show`（只读）使用；未做任何 git 写操作 / pnpm install / test / build；
`workspace-tools.tsx` 保持不挂载（dormant）。OWNS 中 `tests/left-rail-tree.test.ts` 为 leaf-1.2 合法
`deriveGroups` 删除改动的既有结果，本叶未动、typecheck 通过。