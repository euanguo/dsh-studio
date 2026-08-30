# Leaf 4.2 — marketplace 结构收敛

OWNS 收敛：`plugin.tsx` 752→64 行（≤220 → G1 达标）。view 控制器/薄 surface 根与 4 个内聚模块拆成 6 文件；
C4 全部上游探针收口 `marketplace-dom.ts`；C34 过滤复位去 effect 改 key 重挂；C35 effect 链合并首屏单往返；
C39 observer 收窄+脏检查；死导入清理完成。仅 `pnpm run typecheck`（node --test 未跑，任务禁 test）。

## G1 — M4-SPLIT-OK（plugin.tsx=64 ≤220，use-marketplace.ts + marketplace-dom.ts 落位）
`bash -c '...'` 原样通过。新增文件：
- `plugin.tsx`（64）— 仅 `apply()` 入口接线 + 字典注册 + slots 注入。见账本 G1 CHECK。
- `use-marketplace.ts`（57）— `useMarketplaceData`（snapshot/busy/localError 直读 L3.2 `store.ts`，
  requestId/push 复用，未重建 store；`run` 走 `runMarketplaceCommand`）。
- `marketplace-dom.ts`（160）— C4 全部上游探针 + C39 observer 收口。
- `marketplace-filters.tsx`（440）— 过滤 5 态 hook + 派生 + toolbar + 整个 Modal 体（C34 key 重挂宿主）。
- `marketplace-notices.ts`（70）— auth/action notice 本地化派生。
- `marketplace-view.tsx`（272）— view 控制器类 + 薄 surface 根 + 底栏导航项 + 契约接口。

> 说明：为满足硬性行数门槛（主组件 ≤200 / plugin.tsx ≤220），view 控制器（类）与薄 surface 根单独成文件
> `marketplace-view.tsx`，故为 **6 文件**（账本 OWNS 的 4 新建 + plugin.tsx + 此视图控制器文件），
> 不属于账本"五文件落位"字面 5 文件；G1/G2 自动化 CHECK 均原样通过。

## G2 — C4-CLEAR
- `plugin.tsx` 零内联探针：`data-slot=` / `aria-haspopup` / `closest(` / `role="dialog"` 均为空（grep 验证）。
- `marketplace-dom.ts` 带 `COUPLING` 探针耦合注释（settings.trigger slot / closest sidebar /
  button[aria-haspopup=dialog] / role=dialog textContent 群，均标注 pinned 到 rc.x Settings shell）。
- 残留 `marketplace-view.tsx:259` `event.target.closest('button')` 为点击目标上下文判断（非上游布局探针，
  真正的 `settingsButton()` 探针在 marketplace-dom.ts）；`marketplace-browse.tsx:49` `aria-haspopup="menu"`
  是自家组件标记。均合规。

## G3 — 人工复核
**observer 观察范围与回调成本（对照原 :286-290 全扫）**：原 `new MutationObserver` 观察 `document.body`
`{childList, subtree}`，每次突变回调内无条件两轮全文档扫（`settingsDialogOpen()` + schedule→`settingsButton`）。
现 `observeMarketplaceDom`（marketplace-dom.ts）：① 仅 `childList` 监听（不收 attribute/characterData 抖动）；
② 回调按 rAF **合帧**（脏检查 pending-frame，一帧内多次突变只 notify 一次）；③ 全文档 `settingsDialogOpen()`
扫描仅当 `view.#state.open` 为真才执行（open 门控）；④ footer 落点经 `applyFooterStackMarker` 脏检查早退
（target 不变即 return）。观察根保留 `document.body`（须捕获 host 端口化到 body 的 settings dialog，见注释）。

**过滤复位不再经 effect（C34）**：原 `marketplace-view`(旧 plugin.tsx:495-498) 有 `useEffect` 依
`viewState.open` 复位 5 态。现删除该 effect；`MarketplaceSurface` 以 `key={open ? 'open' : 'closed'}`
重挂 `MarketplaceModal`，重开模态即 React key 重挂 → `useMarketplaceFilters` 全新默认态。错误横幅
"reset-and-reload" 走 `filters.reset()` 事件路径（非 effect）。代码路径：`marketplace-view.tsx:127`。

**effect 链合并首屏单往返（C35）**：原挂载 effect 调 `refreshMarketplace` = `getSnapshot()` + `dispatch(refresh)`
两次 host 往返。现 `use-marketplace.ts:51-54` 仅一次 `runMarketplaceCommand(store, {type:'refresh'})`
（dispatch 直接返回鲜活快照），首屏请求数减半；requestId stale-guard 仍由 store 承担。代码路径：`use-marketplace.ts:52`。

**MarketplaceSurface 职责数（新责任边界）**：
- `plugin.tsx`：入口接线（dict 注册 / slots 注入 / bridge 探测 / reflect）。0 渲染职责。
- `marketplace-view.tsx`：view 生命周期（mount 根节点 / open 状态机 / sessions 同步 / settings 关闭 / footer 几何）。
- `use-marketplace.ts`：数据+命令接线（store 订阅 / run）。
- `marketplace-filters.tsx`：过滤/选择态 + 目录派生 + toolbar/Modal 体渲染。
- `marketplace-notices.ts`：横幅字符串派生（纯函数）。
- `marketplace-dom.ts`：上游 DOM 探针 + observer（唯一 pin 点）。

## 死代码/未用导入清理
- 旧 plugin.tsx 移除：`useState`/`useEffect` 全部、`Alert`/`AlertAction`/`EmptyState`/`LoadingState`/
  `ScrollArea`/`RiskConfirmation`/`Menu`/`Pill`/`Modal`/`MenuEntry` 等表层导入、`localizedHostMessage`/
  `localizedAuthDetail`/`settingsButton`/`settingsDialogOpen`/`marketplaceFooter`/`FOOTER_STACK_ATTRIBUTE` 及其
  `refreshMarketplace`（改用单 dispatch）。各新模块无未用导入（typecheck 0 错佐证）。
- marketplace-dom.ts 未留废 import；observeScope 直接 `document.body` 达意，无死分支。

## 验证
- `npx tsc --noEmit`：`plugin-marketplace` 0 error。全仓仅剩 1 处既有 baseline 报错
  `plugins/sidebar/src/client/selection/overlay-arbiter.ts:84`（TS1005，`.ts` 内 JSX，属其他在途 leaf 的 WIP，
  非本 leaf 引入，未触碰）。
- 禁 git/install/test/build：均未执行。