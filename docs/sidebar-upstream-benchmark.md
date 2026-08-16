# 上游 DSH-better-sidebar 基准调研 —— 我们该迁移什么（改造基准文档）

> 状态：**调研完成，未编码**。本文件作为后续改造的基准清单。
> 基线：上游 `main` @ `ecebc97`（v0.12.2 + v0.13 未发布内容：urlTarget）；我们当前主干（oh-dsh-desktop v0.1.2）。
> 原则（已与用户确认）：**概念迁移，代码不合并**。我们的 client 是 2 倍体量的完全重写，中间工作区/行评论/桌面集成是差异化资产；上游值得拿的是"注册协议、设置 seam、工程纪律"这几层，不是它的 UI 与状态模型。
> 配套图：`docs/sidebar-upstream-vs-ours-architecture.svg`（架构对比）。

---

## 0. 迁移执行状态（2026-08 改造已完成，本文件作为基准）

| 项 | 状态 | 落地位置 |
|---|---|---|
| P0-1/P0-2 注册协议契约化 | ✅ | `plugins/sidebar/src/client/contract.ts`（新，契约词汇）、`sidebar-service.ts`（重写：features/version/生命周期/badge/meta/pluginSettings/urlTarget/定向打开/createTab patch/updateTab/openFile/scope） |
| P0-3 类型合并 + 类型子路径 | ✅ | `contract.ts` 的 `declare module 'cordis'`；`@oh-dsh/sidebar/client/contract` 导出子路径 + `scripts/generate-contract-types.mjs`（build 生成 d.ts）+ `scripts/check-consumer-types.mjs`（外部消费者编译门禁，skipLibCheck: false） |
| P0-4 OrphanedTab | ✅ | `SideToolsPanel.tsx`（显示类型 id 的占位卡） |
| P0-5 urlTarget 认领 | ✅ | `sidebar-service.ts` 的 `resolveUrlTarget` + `plugin.tsx` 拦截层（claim 优先、browser 兜底） |
| P0-6 接入文档 | ✅ | `docs/external-plugin-guide.md`（新） |
| P1 设置 seam | ✅ | `pluginSettings` 开放 map（prefs schema + 快照 + 服务方法）、`settings.tsx` 重写（注册表驱动卡片 + 齿轮弹窗 switch/text/number + `settings.render`）、内置 tab 声明 settings（吃狗粮） |
| 吃狗粮拆分 | ✅ | `client/builtins/{tabs,viewers,surfaces,index,deps}`；`client/workspace-tools.tsx`（自 plugin.tsx 拆出）；surface 注册并入服务（`registerSurfaceRenderer`，`surface-renderer-registry.tsx` 已删） |
| P2 契约测试 | ✅ | `tests/sidebar.test.ts` 新增 14 个契约测试（生命周期/badge/urlTarget/pluginSettings/targeted open/surface renderers/createTab patch/updateTab/openFile/features） |
| P2-3 host 基线升级 v0.12.x | ⏳ 未做 | 独立维护任务（漂移仅 8 文件，按 `plugins/sidebar-host/VENDOR.md` 流程） |

---

## 0. 结论摘要

上游 v0.12 的实质进步集中在一件事：**把注册表升级成了有契约的公共 API**（类型合并、能力探测、声明式设置、生命周期、降级路径、接入文档、CI 冒烟），并让内置功能与第三方插件走同一条路（吃狗粮）。我们的 `DesktopSidebarService` 已经长出了同样的注册表骨架，缺的正是这层"契约"。

- **P0 迁移（注册协议契约化）**：TabDescriptor/Service 补齐 features、生命周期、badge、meta、settings 声明、urlTarget；`declare module 'cordis'` 类型合并 + 类型子路径；OrphanedTab；接入文档。
- **P1 迁移（声明式设置 seam）**：`pluginSettings` 开放 map + 注册表驱动设置卡片 + 齿轮弹窗（switch/text/number）+ `settings.render` 自定义面板。
- **P2 迁移（工程纪律）**：CI 挂载冒烟门禁（npm 打包产物 → 独立 profile 挂载 → 无头渲染）；注册表契约测试强化；host 基线升级 v0.12.x。
- **不迁移**：双工作台 UI、上游内置 tab 集合、推荐插件目录、Office 迁移决策、`splits/bottomSplits` reducer。

---

## 1. 上游做得比我们好的 —— 逐项对照

### 1.1 注册协议与契约（核心差距，P0）

| # | 能力 | 上游做法 | 我们现状 | 迁移建议 |
|---|---|---|---|---|
| 1.1.1 | **类型合并** | `declare module 'cordis' { interface Context { betterSidebar: ... } }`（`src/context-types.ts`）；消费方 `import type {} from 'dsh-better-sidebar'` 即触发；导出 `./client/service` 类型子路径；类型图**零 Node 依赖**（`scripts/check-consumer-types.sh` 守护） | 无类型合并（仅 `style.d.ts`）；消费方靠 `ctx.get('desktopSidebar')` + 结构类型手写（`sidebar-desktop/src/client/plugin.tsx`） | **迁移**：补 `declare module 'cordis'` + 类型子路径导出 + Node 依赖守护脚本 |
| 1.1.2 | **能力探测** | `version` + `features` 单调清单（badge/tabLifecycle/updateTab/openFile/targetedOpen/stateSubscription/tabMeta/pluginSettings/urlTarget），消费方 `features.includes()` gate；测试断言版本与 package.json 同步 | 无 | **迁移**：加 `version` + `features` 常量 + 同步测试 |
| 1.1.3 | **状态订阅** | `getSnapshot()` / `subscribeState()`（session 未激活时 state 为 undefined） | 有 `getSnapshot/subscribe` 但无公开 `subscribeState` 语义 | **迁移**：公开等价接口 |
| 1.1.4 | **生命周期回调** | `onOpen/onActivate/onClose`，service 路径触发；dedupe 聚焦算 activate 不算 open；回调抛错只 console.error（`safeCall`） | 无 | **迁移**：在 openTab/closeTab/activateTab 补 hook + safeCall |
| 1.1.5 | **badge 角标** | `badge(ctx, scope, state)`，number 99+ 封顶，抛错吞掉 | 无 | **迁移**（低成本） |
| 1.1.6 | **meta 持久化** | `OpenTabSeed.meta` JSON 序列化跨刷新恢复；`updateTab` 可改 title/path/meta | `PersistedSidebarTab` 只有 id/type/title/resource；`patchTab` 只改 title/resource | **迁移**：加 meta 字段 + updateTab |
| 1.1.7 | **声明式设置字段** | `settings.toggles`（绑定宿主 PrefsSchema 字段）+ `settings.pluginToggles`（插件自有 key，持久化在 `pluginSettings[id]`）+ `settings.render`（自定义面板） | 无（settings.tsx 固定清单） | **迁移**（见 §1.2） |
| 1.1.8 | **urlTarget 外链认领** | 拦截的外链按注册顺序匹配 `urlTarget(url)`，第一个命中者打开；browser 永不声明，隐式兜底；抛错吞掉 | 外链拦截只有 browser 兜底（registry 化多 handler） | **迁移概念**：吸收"认领谓词"进我们的拦截 registry |
| 1.1.9 | **available 三参** | `available(ctx, scope, state)`（只影响 + 菜单 disabled，不拒绝 openTab） | `available()` 零参 | **迁移**：三参化 |
| 1.1.10 | **createTab 可 patch state** | `createTab(state) => { tab, patch? }`，terminal 用它自增 `nextTerminal` | `createTab(seed, tabs) => tab \| null`，不能 patch state | **迁移**：支持返回 patch |
| 1.1.11 | **OrphanedTab** | 持久化 tab 类型未注册时渲染"插件未加载"占位卡，保留 tab 等插件加载后恢复，可关闭 | 无占位（未知类型直接渲染空/出错） | **迁移** |
| 1.1.12 | **统一 props 契约** | `TabComponentProps { ctx, store, scope, tab, visible, expanded?, onToggleDir?, ... }`；component 是纯函数 `(props)=>ReactNode`，可被懒加载包装 | `DesktopSidebarRenderProps { active, close, patch, tab }`，结构不同 | **部分迁移**：对外契约对齐 shape（内部映射） |
| 1.1.13 | **吃狗粮** | 内置 7 tab + 6 viewer 全部经同一 service 注册，描述符元数据（title/icon/settings）直接驱动设置页 | 内置注册走同一 `registerTab/registerViewer`，但元数据没被设置页消费（设置页硬编码清单） | **迁移**：设置页改为描述符驱动 |
| 1.1.14 | **定向打开** | `openTab(seed, scope?)` 落到指定 session，不切 UI；内容型打开自动展开承载面板 | openTab 已 session 化（setSession），但 seed 无 scope 参数 | **迁移**：seed 加 scope |

### 1.2 声明式设置 seam（P1）

| # | 能力 | 上游做法 | 我们现状 | 迁移建议 |
|---|---|---|---|---|
| 1.2.1 | **注册表驱动卡片** | SideCardSection：每个注册 tab/viewer 自动生成卡片（图标 + 标题 + 类型 id + 高亮=启用 + 勾选徽标），viewer 卡片显示扩展名；tabsEnabled/viewersEnabled 开放 map | settings.tsx：tabs/viewers 两个固定 checkbox 列表 | **迁移**：卡片化 + 描述符驱动 |
| 1.2.2 | **齿轮弹窗** | 每卡片齿轮打开原生弹窗：`type: 'switch' \| 'text' \| 'number'` 行（min/max/placeholder/unit），number 钳制，text/number blur/Enter 提交；父级关闭时齿轮隐藏 | 无齿轮；runtime 开关硬编码在设置页 | **迁移**：弹窗 + 行控件 |
| 1.2.3 | **pluginSettings 开放 map** | prefs 文档里 `pluginSettings[<descriptor id>]` 开放 map，插件自有 key 无需宿主 schema 字段；`mergePluginSetting` 写入 | 无 | **迁移**：schema + 持久化 + 写入助手 |
| 1.2.4 | **settings.render** | 自定义设置面板替代行列表，props：store/service/prefs/pluginSettings/updatePluginSetting/close；抛错吞掉并内联错误 | 无 | **迁移** |
| 1.2.5 | **prefs 词汇共享** | `prefs-shared.ts`：类型 + 常量双端共享（host 注册 schemastery schema，client 读写 RPC），浏览器 bundle 不拉 schema 运行时 | `sidebar-preferences.ts`（client）+ host settings 服务，双份 | **参考**：我们的 runtime-settings 已有 revision 守卫 + busy/error 状态机，比上游的简单 RPC 更强，保留 |

### 1.3 测试与工程纪律（P2）

| # | 能力 | 上游做法 | 我们现状 | 迁移建议 |
|---|---|---|---|---|
| 1.3.1 | **CI 挂载冒烟门禁** | `scripts/e2e-mount.sh`：npm pack → `dsh plugin add <tarball>` 装进全新 scratch profile → 真实 `dsh web`（keyless）→ Playwright 无头渲染断言：mount 标记存在、无 crash 条、无 pageerror、逐个打开内置 tab 深扫（含懒加载 chunk） | 有 `scripts/smoke-runtime.mjs`（真实 Electron 冒烟 + 插件注入验证）——但验证的是 stage 目录而非 **npm 打包产物挂到独立 profile** | **迁移**：补"打包产物 → 独立 profile → 无头渲染"一层 |
| 1.3.2 | **注册表契约测试** | `tests/service.spec.ts`（1034 行）：注册/注销生命周期、重复 id 抛错、matchFileViewer 匹配算法、dedupe/createTab/启用 gating；`tests/builtins.spec.ts` 内置清单断言；`api-surface.spec.ts` 版本契约 | 有 `tests/sidebar.test.ts` 等 187 用例，但注册表契约类测试覆盖不足 | **迁移**：补 service.spec 同款契约测试 |
| 1.3.3 | **特征 spec 密度** | orphaned-tab / side-card-section-rows / lazy-chunk / terminal-font / link-intercept / turn-tail-intercept / trusted-hosts / tab-bar-wheel / open-when-sized / manifest-consistency / sidebar-crash 等 41 个 spec ≈ 9000 行 | 187 用例覆盖我们自己的核心（diff/path/runtimes/marketplace 等） | **部分迁移**：为新增契约能力补对应 spec |
| 1.3.4 | **接入文档** | `AGENTS.md`（内部开发约束 + 消费插件 API 全解）+ `docs/external-plugin-guide.md`（外部接入教程） | 无外部插件文档（`docs/PLUGIN-DEVELOPMENT.md` 是内部开发文档） | **迁移**：写我们的 external-plugin-guide |
| 1.3.5 | **纯度门 / consumer 类型检查** | client bundle 禁 value-import 别的插件代码；consumer types 零 Node 依赖守护 | 无 | **参考**：评估 esbuild 纯度门 |
| 1.3.6 | **清单一致性测试** | manifest-consistency.spec（package.json 与产物一致性） | 无 | **参考** |

### 1.4 健壮性与降级（部分值得参考）

| # | 能力 | 上游做法 | 我们现状 | 建议 |
|---|---|---|---|---|
| 1.4.1 | **错误边界分层** | 根 RenderBoundary（壳崩溃 → 可关闭错误条）+ 每 tab error containment + `fail()` 固定诊断条 | center host 已做 crash-proof/自愈（DOM adapter 重挂） | 已有，**不迁**；可补"每 tab 级 error boundary" |
| 1.4.2 | **IME 守卫** | document capture 阶段拦截组合键，防内联第三方组件劫持方向键 | 无 | **参考**：我们的编辑器/查看器是自研，风险低；如引入第三方富文本再评估 |
| 1.4.3 | **open-when-sized** | 终端延迟到容器有尺寸后再 open（零尺寸崩溃防护） | 底部 dock 已有类似处理？需核验 | **核验后参考** |
| 1.4.4 | **拦截纯函数化** | `shouldInterceptLink(href, selfOrigin)` 纯函数可测；urlTarget 匹配独立函数 `matchUrlTarget` | 拦截 registry 化（多 handler + refcount patch），更强 | **参考**：把"认领"逻辑抽纯函数 |

### 1.5 交互细节（参考级，不迁移）

| # | 能力 | 上游做法 | 我们现状 | 建议 |
|---|---|---|---|---|
| 1.5.1 | 双工作台 | 右栏 + 底部面板，拖 tab 跨面板拆分/合并 | 中间工作区 + 右栏 + 底部 dock | **不迁**（产品决策） |
| 1.5.2 | TabBar 滚轮 | 标签页栏滚轮横向滚动 | 我们的 tab 条在中间工作区（surface-tab），无滚轮 | **参考**：如 tab 增多可补 |
| 1.5.3 | 位置兼容模式 | Windows 原生标题栏预留顶部空间（0–120px 可调） | Electron 桌面，无此需求 | **桌面端评估**（我们是否用系统标题栏） |
| 1.5.4 | 窄视口抽屉 | <768px 双工作台合并单面板抽屉 | <900px 全宽抽屉（已有） | 已有，**不迁** |

### 1.6 host 侧演进（可选升级，P2）

上游 host 自我们基线（v0.10.2 @ 3d88752）后的小演进：信任栅栏改用 `webRuntime.trustedHosts`、终端 login shell、jobs 输出活事件镜像。我们 vendored host 与上游仅 8 个文件有差异，本地扩展（fs.search / numstat / blob base64 / worktree-list/add / bulk paths）是我们**比上游强**的部分。
**建议**：把 vendored host 基线升到 v0.12.x，重打本地补丁（按 `plugins/sidebar-host/VENDOR.md` 升级流程），收益是信任栅栏与 host 修复；风险低、工作量小。

---

## 2. 我们做得比上游好的 —— 不回退清单

| # | 能力 | 说明 |
|---|---|---|
| 2.1 | **中间工作区 center surfaces** | file/diff/commit/committed/conflict/browser 等 10 种 surface 开在对话上方（三面体系），上游无此概念 |
| 2.2 | **Git Review + 逐行评论 → composer** | 上游没有评论能力 |
| 2.3 | **committed / unpushed diff** | 上游与参考项目都没有的独有视图 |
| 2.4 | **viewer 族深度** | ipynb / mermaid / CSV 虚拟化 / 大文件分级 / 图片 diff / 合并冲突解决 —— 上游只有 6 个简单 viewer |
| 2.5 | **桌面集成** | webview 浏览器、原生窗口控制、PTY 底部 dock、skins、隔离式插件市场、left-rail |
| 2.6 | **拦截层 registry 化** | 多 handler 链 + refcount patch（`intercept.ts`），比上游单点注册更强 |
| 2.7 | **注册表独有字段** | `action`（动作型 tab，上游没有）、`chrome`、`requiresWorkspace`、`shortcut` |
| 2.8 | **runtime settings 服务** | revision 守卫 + busy/error 状态机 + 队列化写入（`runtime-settings.ts`），上游是简单 RPC |
| 2.9 | **双发行** | desktop/web 共用三面体系与能力层（`plugins/shared`） |
| 2.10 | **host 本地扩展** | fs.search / numstat / blob 预览 / worktree —— 上游 host 没有 |

---

## 3. 迁移实施清单（后续改造基准）

> 每项：动作 → 涉及文件 → 验收标准。P0 是注册协议契约化，做完后我们的宿主对外呈现与上游同构。

### P0 —— 注册协议契约化（纯增量，不动 UI）

| 项 | 动作 | 涉及 | 验收 |
|---|---|---|---|
| P0-1 | TabDescriptor 补齐：`settings`（toggles/pluginToggles/render）、`badge`、`onOpen/onActivate/onClose`、`urlTarget`、`available` 三参、`createTab` 支持 patch、`meta` | `plugins/sidebar/src/client/sidebar-service.ts`、`sidebar-preferences.ts` | 内置 tab 全部满足新字段；契约测试覆盖 lifecycle/dedupe/createTab |
| P0-2 | Service 补齐：`version` + `features`、`getSnapshot/subscribeState` 公开语义、`updateTab`、`activateTab`、`openFile(scope,path)`、`openTab(seed, scope?)` 定向 | `sidebar-service.ts` | 与上游 features 清单对齐的单调列表；version 与 package.json 同步测试 |
| P0-3 | 类型契约：`declare module 'cordis'` 类型合并 + 类型子路径导出 + 零 Node 依赖守护脚本 | 新 `plugins/shared/sidebar-contract.ts`（或 sidebar 包导出） | 外部插件 `import type {}` 后 `ctx.desktopSidebar.registerTab` 类型可用；`skipLibCheck: false` 可编译 |
| P0-4 | OrphanedTab：未注册类型渲染占位卡（保留 tab、可关闭、插件加载后恢复） | `SideToolsPanel.tsx`（或新组件） | orphaned-tab spec 同款测试 |
| P0-5 | 外链 urlTarget 认领：拦截 registry 支持"认领谓词"（browser 隐式兜底） | `intercept.ts` | 插件可声明域名认领；link-intercept spec 同款测试 |
| P0-6 | 接入文档：`docs/external-plugin-guide.md`（对照上游 §2–§9 写我们的版本） | `docs/` | 覆盖：依赖声明/最小骨架/注册示例/类型导入/生命周期与 HMR |

### P1 —— 声明式设置 seam

| 项 | 动作 | 涉及 | 验收 |
|---|---|---|---|
| P1-1 | `pluginSettings[id]` 开放 map（schema + 持久化 + `mergePluginSetting` 助手） | `sidebar-preferences.ts`、`settings.tsx` | 插件自有 key 无需宿主 schema 字段即可持久化 |
| P1-2 | 设置页卡片化：描述符驱动（图标/标题/id/高亮=启用）+ 齿轮弹窗（switch/text/number 行，min/max/placeholder/unit） | `settings.tsx` | side-card-section-rows spec 同款测试 |
| P1-3 | `settings.render` 自定义面板（props：store/service/prefs/pluginSettings/updatePluginSetting/close） | `settings.tsx` | 抛错吞掉 + 内联错误 |

### P2 —— 工程纪律与维护

| 项 | 动作 | 涉及 | 验收 |
|---|---|---|---|
| P2-1 | CI 挂载冒烟门禁：npm pack → 独立 scratch profile 挂载 → 真实 DSH 无头渲染 → 断言无 crash + 逐个打开内置 tab | `scripts/`（参照上游 e2e-mount.sh） | CI 上 npm 打包产物可挂载渲染 |
| P2-2 | 注册表契约测试强化（service.spec 同款：注册/注销/重复 id/匹配算法/dedupe/createTab/启用 gating） | `tests/sidebar-service.test.ts` | 关键路径全覆盖 |
| P2-3 | host 基线升级 v0.12.x + 重打本地补丁，更新 VENDOR.md | `plugins/sidebar-host/` | `pnpm build && pnpm test` 全绿；信任栅栏用 webRuntime.trustedHosts |

---

## 4. 不迁移清单与理由

| 项 | 上游做法 | 不迁移理由 |
|---|---|---|
| 4.1 | 双工作台（splits/bottomSplits reducer + 拖 tab 拆分合并） | 我们有中间工作区 + 底部 dock，产品决策不同；迁移=推翻自己 |
| 4.2 | 内置 tab 集合（subagent 拓扑页等） | 我们的集合（review/files/side-chat/trajectory/browser）是 Review/Desktop 导向 |
| 4.3 | 推荐插件目录（添加插件弹窗） | 我们有 plugin-marketplace（隔离预览/应用/恢复），更强 |
| 4.4 | Office 预览迁移决策 | 我们没有 Office 包袱 |
| 4.5 | `prefs-shared` 的 schemastery schema 注册方式 | 我们的 runtime-settings 服务已更强（revision 守卫 + 状态机） |
| 4.6 | IME 守卫、位置兼容模式 | 自研查看器风险低；桌面用系统窗口时无标题栏兼容需求（保留评估项） |

---

## 5. 参考文件索引

**上游（`DSH-better-sidebar` main @ ecebc97）：**
- 服务与契约：`src/client/service.ts`（786 行，注册表 + features + 生命周期）、`src/context-types.ts`（类型合并）
- 内置参考实现：`src/client/builtins/tabs.tsx`（7 tab 描述符）、`viewers.tsx`（6 viewer）、`index.ts`
- 设置页：`src/client/SideCardSection.tsx`（877 行，卡片/齿轮/pluginSettings）
- 状态模型：`src/client/state.ts`（splits/bottomSplits reducer）、`src/client/Sidebar.tsx`
- 拦截：`src/client/intercept.tsx`、`link-intercept.ts`（shouldInterceptLink 纯函数）、`openpath-intercept.ts`
- 降级：`src/client/OrphanedTab.tsx`、`RenderBoundary.tsx`
- 懒加载：`src/client/chunk-loader.ts`、`lazy-chunk.tsx`
- 测试：`tests/service.spec.ts`、`builtins.spec.ts`、`api-surface.spec.ts`、`tests/e2e/mount.e2e.ts` + `scripts/e2e-mount.sh`
- 文档：`AGENTS.md`、`docs/external-plugin-guide.md`、`docs/plans/2026-08-11-service-registry-design.md`、`2026-08-11-declarative-sidebar-settings-design.md`

**我们（oh-dsh-desktop）：**
- 注册表：`plugins/sidebar/src/client/sidebar-service.ts`、`sidebar-preferences.ts`、`sidebar-storage.ts`
- 装配：`plugins/sidebar/src/client/plugin.tsx`（内置注册 + 服务暴露 + settings section）
- 设置：`plugins/sidebar/src/client/settings.tsx`、`runtime-settings.ts`
- 拦截：`plugins/sidebar/src/client/intercept.ts`
- 消费示例：`plugins/sidebar-desktop/src/client/plugin.tsx`
- 能力层：`plugins/shared/`（git-core/fs-tree/wire/sidebar-api/path/surface-tab）
- vendor：`plugins/sidebar-host/VENDOR.md`
- 既有审计：`docs/sidebar-code-audit.md`、`docs/sidebar-structure-plan.md`、`docs/sidebar-distribution-plan.md`
