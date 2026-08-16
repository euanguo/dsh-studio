# 架构清晰化：文件拆分 / 目录拆分优化清单

> 状态：**实施中**，归入开发文档的「架构」部分。
> 目标：让目录结构、文件职责清晰，便于后续开发者（人类与 Agent）定位与维护。
> 依据：全量扫描每个插件的目录平铺度 + 大文件的 export/函数复杂度。
>
> **已落地**：
> - ✅ `desktop-sidebar/src/client` 归并 `source-control/`、`review/`、`files/` 三个子目录。
> - ✅ `BrowserView` 从 `SideToolsPanel.tsx` 拆出为 `browser-view.tsx`，`BrowserSurfaceView`
>   从 `surfaces/renderers.tsx` 收拢到 `browser-view.tsx`；`ElectronWebviewElement` 接口单处 export。
>   （这两个 webview 组件是 desktop-only，后续整体移入 desktop 增强包。）

---

## 0. 结论速览

两类优化项，按影响排序：

**A. 目录平铺（文件挤在一个大目录、该分子目录）**
- 最重：`plugins/desktop-sidebar/src/client/`（**25 文件平铺**）、`plugins/shared/`（17）、`plugins/better-sidebar-runtime/src/`（17）

**B. 上帝文件（函数特别多、特别大、该拆）**
- 最重：`WorkspaceBrowser.tsx`(1669) / `transaction-manager.ts`(1118) / `better-sidebar-runtime/index.ts`(897) /
  `src/main.ts`(819) / `SideToolsPanel.tsx`(806) / 两个 `plugin.tsx`(800/921)

---

## 1. 目录拆分清单（平铺 → 分子目录）

### 1.1 `plugins/desktop-sidebar/src/client/`（25 文件平铺）⭐ 最需要拆

现状：已有 `diff/`、`runtimes/`、`surfaces/` 三个子目录，但 source-control、review、files、chrome、服务类
共 25 个文件仍平铺在根。建议目标结构：

```
client/
├── plugin.tsx            # 组装层（拆后变薄，见 2.6）
├── client.ts             # 入口导出
├── client-types.ts       # 结构类型
├── i18n.ts               # 文案
├── better-sidebar-api.ts # API 客户端
├── intercept.ts          # openPath 拦截
├── settings.tsx          # 设置区
├── sidebar-service.ts    # 面板服务（或归 services/）
├── source-control/       # ← 归并 4 个平铺文件
│   ├── source-control-panel.tsx
│   ├── source-control-tree.ts
│   ├── source-control-view-model.ts
│   └── source-control.css
├── review/               # ← 归并 3 个平铺文件
│   ├── review-comments.ts
│   ├── review-diff.ts
│   └── review-types.ts
├── files/                # ← 归并文件查看相关
│   ├── file-viewers.tsx
│   ├── content-viewer.tsx
│   ├── file-tree-model.ts
│   └── syntax-highlight.ts
├── chrome/               # ← SideToolsPanel 拆分出的面板 chrome（见 2.5）
├── diff/                 # 已存在
├── runtimes/             # 已存在
└── surfaces/             # 已存在
```

### 1.2 `plugins/better-sidebar-runtime/src/`（17 文件平铺）

现状：`index.ts`（897 行上帝文件）+ 能力模块平铺。建议：

```
better-sidebar-runtime/src/
├── index.ts              # 只剩 apply() 装配（拆后变薄）
├── context-types.ts
├── config.ts
├── prefs-shared.ts
├── trust-fence.ts
├── browser-probe.ts
├── invariant.ts
├── vendor.d.ts
├── routes/               # ← 从 index.ts 拆出
│   ├── api-route.ts      # /sidebar/api（buildApi + dispatch）
│   ├── media-route.ts    # /sidebar/file
│   ├── html-route.ts     # /sidebar/html（现 html-route.ts 迁入）
│   ├── bundle-route.ts   # /sidebar/bundle（迁入）
│   └── terminal-ws.ts    # 两个 WS 升级
├── pty/                  # ← 归并终端能力
│   ├── pty-manager.ts
│   ├── agent-pty.ts
│   └── tools.ts
└── core/                 # ← 归并 framework-agnostic 能力
    ├── git.ts            # re-export（下沉 shared 后可删）
    ├── fs-tree.ts        #（下沉 shared）
    ├── wire.ts           #（下沉 shared）
    └── jobs-routes.ts
```

### 1.3 `plugins/shared/`（17 文件平铺）

现状：git-core、sidebar-api(wire)、runtime、UI 组件、i18n 混在一起。建议按"层"分：

```
shared/
├── host/                 # ← host 侧能力
│   ├── git-core.ts
│   ├── sidebar-api.ts    # wire 契约
│   ├── fs-tree.ts        #（从 better-sidebar-runtime 迁入）
│   └── wire.ts           #（迁入）
├── runtime/              # ← 状态原语
│   └── runtime.ts
├── ui/                   # ← 组件/样式
│   ├── list-row.tsx/.css
│   ├── filename-label.tsx/.css
│   ├── surface-tab.tsx/.css
│   ├── icons.tsx
│   ├── tabler-icons.tsx
│   ├── middle-truncate-text.ts
│   ├── filename-display.ts
│   └── theme.css
└── i18n/
    ├── i18n.ts
    └── use-i18n.ts
```

> 注：shared 的目录拆分与「分发规划」S1（能力下沉）联动——`fs-tree`/`wire` 迁入 shared 时，正好落到 `shared/host/`。

### 1.4 `plugins/desktop-left-rail/src/client/`（13 文件平铺 + 1 个巨型文件）

现状：`rows/` 子目录已存在，但 `WorkspaceBrowser.tsx`（1669 行）平铺在根。建议：

```
client/
├── WorkspaceBrowser/     # ← 拆分巨型文件（见 2.1）
│   ├── WorkspaceBrowser.tsx
│   ├── SessionTree.tsx
│   ├── FlatList.tsx
│   ├── SearchResults.tsx
│   └── ViewOptionsMenu.tsx
├── rows/                 # 已存在
├── tree.ts
├── stores.ts
├── worktree-api.ts
└── ...
```

---

## 2. 上帝文件拆分清单（函数特别多 / 特别大）

> 判定依据：行数 + export 数 + 内部是否挤了多个组件/职责。`export` 多为纯函数库通常是**合理大文件**，不在此列。

| 文件 | 行数 | 问题 | 拆分建议 |
|---|---|---|---|
| `desktop-left-rail/src/client/WorkspaceBrowser.tsx` | 1669 | 1 个组件 900 行 + `SessionTree`/`FlatList`/`SearchResults`/`ViewOptionsMenu` 4 个子组件同文件 | 拆成 `WorkspaceBrowser/` 目录，子组件各一文件 |
| `plugin-marketplace/src/host/transaction-manager.ts` | 1118 | host 事务核心单文件 | 按事务阶段（install/upgrade/rollback/preview）拆 |
| `better-sidebar-runtime/src/index.ts` | 897 | `apply()` 塞进全部路由 + pty + settings + 工具 | 路由拆 `routes/`、pty 拆 `pty/`（见 1.2） |
| `plugin-marketplace/src/client/plugin.tsx` | 921 | 组装层 | 拆 `registerMarketplace*` 各模块 |
| `src/main.ts` | 819 | Electron 主进程单文件 | 按窗口管理 / IPC / marketplace 宿主 / 日志拆 |
| `desktop-sidebar/src/client/SideToolsPanel.tsx` | 806 | 8 个组件同文件（`SideMenu`/`BrowserView`/`FilesView`/`FileView`/`PinnedTabs`/`AddToolsMenu`/`TabStrip`/`PanelActions`） | 面板 chrome 拆 `chrome/`，`FilesView`/`FileView` 归 `files/`，`BrowserView` 归增强层 |
| `desktop-sidebar/src/client/plugin.tsx` | 800 | `apply()` + `registerBuiltinSidebarTools`(170行) + `registerCenterSurfaceRenderers` 全塞 | 拆多个 `register*` 模块 |
| `desktop-sidebar/src/client/workspace-panel.tsx` | 748 | Git 面板单文件 | 按 section（变更列表/历史/事实区）拆 |

---

## 3. 合理大文件（**不建议拆**，记录理由避免误拆）

| 文件 | 行数 | 为何不拆 |
|---|---|---|
| `shared/git-core.ts` | 625（41 export） | 纯函数 git 库，每个函数小而独立，聚合型，拆了反而割裂 |
| `better-sidebar-runtime/src/client/state.ts` | 1048（50 export） | **死代码**（审查文档发现 G），是删不是拆 |
| `desktop-sidebar/src/client/i18n.ts` | 430 | 文案聚合，应保留单文件；但需清死 key（审查发现 H） |
| `desktop-left-rail/src/client/tree.ts` | 631（24 export） | 树纯函数，可接受；若继续膨胀再评估 |
| `desktop-sidebar/src/client/sidebar-service.ts` | 527（10 export） | 单一 service 类，职责清晰 |
| `better-sidebar-runtime/src/agent-pty.ts` | 519 | 单一注册表职责 |

---

## 4. 与其它文档的关系 / 执行顺序

- 本文档 = **架构清晰化**（拆文件、拆目录），是开发文档的「架构」部分。
- 与 `sidebar-code-audit.md`（卫生审查）：上帝文件 = 审查发现 L 的展开；目录平铺是新增维度。
- 与 `sidebar-distribution-plan.md`（分发规划）：
  - 拆分「上帝文件」应在**分发拆分（S3–S6）之前或同步**做——先把 `index.ts`/`plugin.tsx`/`SideToolsPanel.tsx`
    拆薄，Electron 能力（`BrowserView` webview）才容易单独拎出到增强层。
  - `shared` 目录拆分与 S1（能力下沉）联动，迁入的 `fs-tree`/`wire` 直接落 `shared/host/`。
- 建议执行顺序：**先拆目录骨架（第 1 节，低风险纯移动）→ 再拆上帝文件（第 2 节，逐文件小步）→
  最后做分发拆分（S3+）**。每步 `pnpm typecheck` + `pnpm test` 回归。

---

## 5. 一句话总结

> 三个目录（`desktop-sidebar/client`、`shared`、`better-sidebar-runtime/src`）需要按功能分子目录；
> 8 个"上帝文件"需要拆薄（最重的 `WorkspaceBrowser.tsx` 1669 行、`transaction-manager.ts` 1118 行、
> `better-sidebar-runtime/index.ts` 897 行）。纯函数库（`git-core`）和死代码（`state.ts`）**不拆**——一个合理、一个该删。
