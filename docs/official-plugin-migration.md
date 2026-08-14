# 官方 DSH 插件迁移指南（通用路线，非一次性补丁）

> 目标：任何官方 `dsh.client` 插件都能按同一套流程迁入 Oh-DSH-Desktop，
> 而不是为每个插件手写垫片。本文是官方机制的第一手梳理 + 迁移配方。
>
> 官方源码：`.cache/dsh-source/<commit>/`（完整 monorepo 克隆，dsh-root
> 0.1.0-rc.5，commit `47f943859bef60e4160492346772ded9b24f765a`）。
> web-app bundle 锁定该版本，迁移必须针对同一 commit 进行。

---

## 1. 官方插件到底是什么

一个官方 UI 插件（如 `@deepseek-ai/dsh-client-ui-workspace`）是一个**双面包**：

### 1.1 清单：`package.json` 的 `dsh.client`

```jsonc
{
  "dsh": {
    "client": {
      "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-runtime",
                 "@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-sidebar"],
      "platform": "web"
    }
  }
}
```

- `inject`：**预取/加载提示**（激活顺序由服务可用性决定，不是依赖排序）。
- 包导出 `./client` → `lib/client.js`（浏览器半）+ node 半（如有）。

### 1.2 构建：tsdown → 闭包工厂 bundle

`packages/client/tsdown.client.ts`（共享预设）把每个客户端包打成：

```js
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-ui-workspace",
  factory: (require) => { /* CJS 闭包 */ },
})
```

- 外部依赖通过注入的 `require` 解析（模块表），**不引全局、不用 import map**。
- CSS Modules 由 lightningcss **打进 bundle 内部**：`import 'x.module.css'` 得到
  哈希类名映射，CSS 文本在工厂执行时自动注入 `<style data-plugin="<id>">`，
  loader 卸载时删除插件自有样式标签。
- 平台词表 `PLATFORM_MODULES`（`packages/client/web/src/platform.ts`）：
  `react*`、`@deepseek-ai/cordis`、`dsh-client-ui-slots`、`dsh-client-web-react`、
  `dsh-client-ui-primitives`、`dsh-client-ui-attachment`、`dsh-client-schema-form`。

### 1.3 运行时：boot 图 + 模块表 + 槽位

- `dsh-client-modules`（node 半）扫描 host Loader 里声明了 `dsh.client` 的包，
  组装 `window.__DSH_BOOT__`（`{rev, entries}`，实测 44 条），
  提供 `/plugins/<id>/client.js` 与 source map，以及 HMR 的 node 半。
- 浏览器半 `ClientModuleLoader`（`modules/src/client/system.ts`）的
  `makeRequire` 解析顺序：
  1. **平台种子**（`web/src/seed.ts` 静态表，仅 10 个词）
  2. **shell 自有模块**
  3. **已注册 bundle**（loadCache 记忆化 → 未注册的递归物化，加载顺序自解析）
  4. 其余 → 报错（构建期外部依赖漂移 / 禁止的跨插件值导入）
- 槽位系统：`dsh-client-ui-slots` 的 `SlotRegistry`。宿主声明槽（如
  `ui-sidebar` 的 `sidebar.workspaces`：`{kind: 'single', scope: 'root'}`），
  插件 `ctx.slots.inject(name, () => ctx.slots.register({...}, Component))` 填充。
  **`single` 槽 = 单主人**：禁用官方行、注册我们自己的组件，就是官方认可的整体替换路径。

### 1.4 补丁：cordis.patch.yml 分层

`packages/bundle/{base,web-app}/cordis.patch.yml` 是官方插件表，用户 profile 的
`cordis.patch.yml` 叠加。规则：

- 行按 `id` 寻址，**最后写入者生效**；`config` 是整体替换不是合并。
- `disabled: true` 是官方 web-app 自身就在用的机制（4 处），不是我们的 hack。

---

## 2. 我们桌面端的接入面（现状）

- **profile 组装**（`src/profile.ts`）：`dsh-base` + `dsh-web-app` + `@oh-dsh/desktop`
  三个 bundle 层；`BUNDLED_DESKTOP_PLUGINS` 列出桌面自带插件。
- **插件包**：`plugins/<name>/`，名字 `@oh-dsh/<name>`，`package.json` 带
  `dsh.client.inject`（与官方清单同构）。根 `cordis.patch.yml` 追加：
  ```yaml
  - id: ui-workspace          # 官方行：禁用
    disabled: true
  - insert:
      - id: oh-desktop-left-rail   # 我们的行：同名槽注册我们的实现
        name: '@oh-dsh/desktop-left-rail'
  ```
- **构建/同步**：esbuild 打 `dist/plugins/<name>/client.js`（同样是
  `__ModuleLoader__.load({id, factory})` 闭包工厂，与官方同构）；
  `scripts/dev.mjs` 把 6 个包的 `package.json` + dist 同步进
  `.stage/dsh-runtime/node_modules/@oh-dsh/*`（profile 里是符号链接，
  **package.json 缺失会让加载失败**）；官方 `client-modules` 直接服务这些 bundle。
- **hot reload**：编辑 `plugins/*/src/client.*` → dev.mjs 重建 + 同步，
  HMR node 半通知浏览器刷新 bundle。

## 3. 通用迁移配方（`scripts/vendor-plugin.mjs`）

对官方包 `P`（如 `ui-workspace`）迁移到 `plugins/<target>/`：

1. **拷源码**：从 `.cache/dsh-source/<commit>/packages/client/P/src/` 拷贝
   （排除 `tests/`、`.test.ts`）。
2. **清单**：生成 `package.json`，`dsh.client.inject` 照抄官方 manifest；
   exports 补 `./client`、`./package.json`（stage 同步与 client-modules 都要读）。
3. **补丁**：生成/追加「禁用官方行 + insert 我们的行」两段（同一 id 语义）。
4. **external 清单**：把插件 import 的模块分成三类——
   - 平台种子（react、cordis、ui-slots、**ui-primitives**、web-react、…）→ external；
   - 其他官方 client 包（runtime、locale、ui-sidebar、ui-conversation、…）
     → external（boot 图里有注册，require 自解析）；
   - 纯库（clsx、dsh-invariants…）→ 打进 bundle。
5. **类型**：**不要手写 vendor.d.ts，也禁止 ambient `declare module`**。
   用官方构建产物 `lib/types/**/*.d.ts` 做 tsconfig `paths` 映射
   （`scripts/vendor-plugin.mjs --types` 自动生成**传递闭包**——官方类型跨包
   再导出，如 runtime 的 `SessionId` 来自 `dsh-client-connection/client`，
   闭包解析按包的 `exports.types` 寻址扁平布局 `lib/types/<sub>.d.ts`）：
   ```jsonc
   "paths": {
     "@deepseek-ai/dsh-client-runtime": ["./.cache/dsh-source/<commit>/packages/client/runtime/lib/types/index.d.ts"],
     "@deepseek-ai/dsh-client-runtime/client": ["./.cache/dsh-source/<commit>/packages/client/runtime/lib/types/client/index.d.ts"],
     // …闭包约 29 条（含 dsh-llm/types、dsh-session/surface、dsh-api-remotes/client…）
   }
   ```
   类型与运行时同一来源，不再漂移。**已验证**：替换后全仓 typecheck 0 错误，
   `@ts-nocheck` 全摘；`defineStore` 遵循官方双泛型签名（`init` 推出 T，
   **不要写显式 `<T>`**——否则 A 无法推断，`draft` 塌成 `T | State`）。
6. **CSS**：`scripts/plugin-styles.mjs <plugin-dir>` 把每个 `.module.css` 转成
   **按文件前缀重命名**的类名映射 + 合并作用域 CSS（构建时生成、入库）。
   - 命名：`<class>` → `ohlr-<kebab-file-stem>-<class>`（如
     `WorkspaceBrowser.module.css` 的 `.iconButton` → `ohlr-workspace-browser-iconButton`）。
     这等价于官方每文件哈希类名：**同名类跨文件不冲突**（官方 `.iconButton` 在
     browser 里 28px、rows 里 16px，全局身份映射会后者覆盖前者——真实踩过的坑）。
   - 组件按文件导入各自映射（`import { WorkspaceBrowserCss as css }`），
     portal 菜单/对话框**不需要**作用域属性包装——类名本身全局唯一。
   - `@media` 递归、`@keyframes` 原样（名称是文档全局的）、注释先行剥离。
7. **验证**：`pnpm run typecheck && pnpm run build`，重启 dev，CDP 检查
   `#<plugin>-styles` 标签、作用域元素计算样式、`__DSH_BOOT__.entries` 含新 id、
   官方行不在图里。

## 4. ui-workspace 案例复盘（第一条流水线）

已验证的事实：

- 官方 `ui-workspace` 行禁用后**整包从 boot 图消失**（44 条 entry 无它），
  我们的 `@oh-dsh/desktop-left-rail` 是一等公民 entry（`immediately: true`）。
- 运行时 `require` 能解析的官方模块：平台种子 + boot 图里注册的 bundle。
  **`ui-primitives` 是平台种子** —— 本地 primitives shim 已整体删除，
  fork 直接 external 官方 `@deepseek-ai/dsh-client-ui-primitives`
  （Menu/Modal/HoverCard/Tooltip/Button/StateDot + 全部图标 1:1 官方实现，
  bundle 1.0MB → 107.6KB）。注意：shim 曾用错图标（tabler 空心三角 vs
  官方实心 `ic_ds_triangle_right_fill_14`）——这就是「展开图标不对」的根因，
  也是「凡是 shim 必然漂移」的教训：能用官方就用官方。
- CSS 类名碰撞（`.iconButton` 28px vs 16px 跨文件覆盖）是属性作用域 + 全局
  身份映射的缺陷；已改为按文件前缀重命名（见 §3.6），宽/窄栏、菜单、对话框
  全部官方形态。
- 手写 `vendor.d.ts` 与 ambient `declare module` 是**已被淘汰的过渡手段**：
  desktop-skins 的一个 ambient 垫片（`declare module '@deepseek-ai/dsh-client-runtime/client'`）
  曾全局遮蔽官方 runtime 类型，让全仓出现 "no exported member"。
  删除后全仓 0 错误；两个 `@ts-nocheck`（WorkspaceBrowser / WorkspacePicker）
  已随官方类型接入摘除。
- CSS 管线已验证：18KB 作用域 CSS 注入、根元素 `display:flex/column`、
  `.sectionHeader` 36px、`.projectRow` 34px 全部生效；`@media`/`@keyframes`
  正确处理（注释先行剥离，否则注释文本会被当选择器处理）。

## 5. 未来插件迁移清单（checklist）

- [ ] 官方包在 `.cache/dsh-source/<commit>/packages/client/` 下存在对应 `lib/types`
- [ ] `vendor-plugin.mjs` 拷 src + 生成 package.json（dsh.client.inject 照抄）
- [ ] cordis.patch.yml：官方行 `disabled: true` + insert 我们的行
- [ ] build-config `external` + `pluginPackages` 注册
- [ ] `--types` 生成 tsconfig paths 闭包；**禁止 ambient `declare module`**；确认无 `@ts-nocheck` 残留
- [ ] `plugin-styles.mjs` 生成前缀重命名 CSS + 每文件类映射；**禁止手写 primitives/组件 shim——能用官方就用官方**
- [ ] dev.mjs SYNC_PAIRS 覆盖新包（package.json + dist）
- [ ] 构建、typecheck、boot（`__DSH_BOOT__.entries` 含新 id）、CDP 样式验证
