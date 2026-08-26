# DSH 插件市场开源生态调研（2026-08-26）

> 范围：**只调研 DeepSeek Harness（DSH）插件生态自己的、GitHub 上开源的插件市场/目录**，不涉及其他产品生态。
> 方法：直接抓取一手数据 —— 市场目录 JSON（`data/plugins.json`、`plugins.json` API）、仓库 README、脚手架模板源码；star 数用 GitHub 仓库页 HTML 抓取实测（本机 `api.github.com` 直连超时，未使用）。所有星数抓取于 2026-08-26。
> 性质：时点调研笔记（中文单份，非产品文档，不设双语对）。

## 1. 结论速览

DSH 没有官方 registry，市场完全由社区构成，已分化出三种形态：

| 形态 | 说明 | 代表 |
|---|---|---|
| **注册表 / 目录站** | 精选列表 + 网站 + 公开 JSON API；只发现不安装 | awesome-dsh-plugin、dsh-suite 目录 |
| **应用内市场插件** | 装进 DSH Web UI 的 cordis 插件：浏览/搜索/一键安装/更新/卸载 | dsh-market、bradeGithub、chnjames、AwesomeHou 等 |
| **双形态平台** | 静态 Web 站 + DSH 插件端共用一份数据 | 2BingLing/dsh-market |

### 星数排名（2026-08-26 实测抓取）

| # | 仓库 | ★ | 形态 | 规模 | 备注 |
|---|---|---|---|---|---|
| 1 | [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | **12,850** | 注册表 + 网站 | 2,231 条 | PR 精选制；是 dsh-market 的官方目录源 |
| 2 | [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market) | **2,474** | 应用内市场 | 引用上表目录 | [dshmarket.com](https://dshmarket.com)；npm 包 `dshmarket` |
| 3 | [AdamPlatin123/awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) | 1,397 | 目录站 | — | 带每日兼容性追踪 |
| 4 | [0xsline/awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) | 909 | 目录站 | — | 生态策展（含基础设施） |
| 5 | [bruc3van/awesome-dsh-plugin](https://github.com/bruc3van/awesome-dsh-plugin) | 278 | 目录站 | — | 中英双语完整列表 |
| 6 | [bradeGithub/DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace) | 146 | 应用内市场 | 全量 topic（460+） | jsDelivr 静态索引；第三方 Windows 桌面端内置 |
| 7 | [Alex-Yanggg/awesome-DSH-plugin](https://github.com/Alex-Yanggg/awesome-DSH-plugin) | 84 | 目录站 | — | — |
| 8 | [2BingLing/dsh-market](https://github.com/2BingLing/dsh-market) | 75 | 双形态 | 收录 4,276 | [dsh.market](http://dsh.market/)；五维评分 |
| 9 | [vlln/plugin-registry](https://github.com/vlln/plugin-registry) | 58 | 注册表 | — | — |
| 10 | [whyihaveyou/dsh-suite](https://github.com/whyihaveyou/dsh-suite) | 48 | 活目录 + Store | 1,764 主目录 + 950 观察区 | 每小时刷 star、每日兼容实测；DSH Studio 默认目录源 |
| 11 | [AwesomeHou/dsh-plugin-marketplace](https://github.com/AwesomeHou/dsh-plugin-marketplace) | 26 | 应用内市场 | 1,800+ topic 实时 | 异步安装任务/进度条 |
| 12 | [chnjames/dsh-plugin-market](https://github.com/chnjames/dsh-plugin-market) | 4 | 应用内市场 + 目录站 | — | [dsh-plugin-market.vercel.app](https://dsh-plugin-market.vercel.app) |
| 12 | [DshMarketPlace/dsh-plugins-store](https://github.com/DshMarketPlace/dsh-plugins-store) | 4 | 应用内市场 | 经 [dshmarketplace.dev](https://dshmarketplace.dev) | `/store` 命令 + agent 工具 + 公共 API |
| 13 | [sandbaseai/dsh-plugin-store](https://github.com/sandbaseai/dsh-plugin-store) | 3 | 应用内市场 | 4,000+ 包 / 3,400 仓 | 数据来自 [DSH Plugin Leaderboard](https://dshpluginleaderboard.com/) |
| 14 | [ouyangyipeng/dsh-marketplace](https://github.com/ouyangyipeng/dsh-marketplace) | 2 | 应用内市场 | topic 1,000 上限 | 安全强化；DS-Harness Desktop 内置 |

参照锚点：官方框架 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 197,063★（框架本体不计入插件市场）。另有多个第三方桌面客户端出厂内置市场：dataelement/dsh-desktop、hairyf/deepseek-harness-desktop、anywhere-labs/deepseek-harness-desktop（内置 dsh-market）、DS-Harness Desktop（内置 ouyangyipeng 版）、baiyuscc13724-max/deepseek-harness-desktop（内置 bradeGithub 版）。

## 2. 插件是怎么实现的（生态共识）

所有市场收录的都是同一套 DSH 插件协议，证据取自 [`create-dsh-plugin` 脚手架模板](https://github.com/whyihaveyou/dsh-suite/tree/main/packages/create-dsh-plugin)与各市场 README：

**包结构（host 半 + client 半）**

- `package.json` 用两个保留字段声明：
  - `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` —— host 半入口；
  - `dsh.client` —— 浏览器半（注入 Web UI 的设置页 Tab、面板等），构建产物为 `__ModuleLoader__` bundle。
- `cordis.patch.yml` 是插入 Loader 树的 patch 层：
  ```yaml
  - insert:
      - id: {{PLUGIN_ID}}
        name: {{PKG_NAME}}   # 注意：name 是包名（经 profile node_modules 解析），不是相对路径
  ```
- `peerDependencies: { "@deepseek-ai/cordis": "^x" }` 声明兼容范围（也是兼容性日检的第一层依据）；工具型插件依赖 `@deepseek-ai/dsh-tools`。
- 能力面（各市场实现里反复出现）：host 侧 `ctx.tools.register` 注册 agent 工具、在 `ctx.webServer` 挂同源 HTTP 端点（如 `/api/market/*`）、注册 remote 方法供浏览器 inject 调用；client 侧占位 `settings.plugins.tab` 槽位。

**两类可安装物**

1. **cordis 型**：上述 bundle 协议，走 `dsh plugin --profile web add <pkg|github:owner/repo#ref|tarball>` 安装进 profile；
2. **skill 型**：根目录 `SKILL.md` 或 `skills/*/SKILL.md`，直接 clone 进 `~/.dsh/skills/`（[dsh.market 的收录检测与安装路由即按这两类分叉](https://github.com/2BingLing/dsh-market)）。

**分发通道优先级**（dsh-market 的实践）：经验证的 npm 包 → 作者 GitHub Release 预构建 tarball → 整仓源码下载。预构建安装「数秒完成且无需执行本地构建脚本」；monorepo 型则 clone 后 pnpm 构建 + `link:` 注册（AwesomeHou 方案，注意 `link:` 不能装根级插件）。

## 3. 头部市场深挖

### 3.1 awesome-dsh-plugin（12,850★）— 精选注册表

- **收录门槛**（README "What it takes to be listed here"）：能用 `dsh plugin add` 安装、声明 `dsh.bundle` manifest、描述与实际行为一致（"声称 46 个工具就有人去数"）、分类正确、持续维护；不维护/损坏会被移除。明确声明「上榜不是安全审查」并给出第三方代码风险免责声明。
- **治理分离**：这里是唯一目录真相源；市场应用（dsh-market）只消费它，「上架请来这里提 PR，别提到市场仓库」。
- **数据 API**：[`awesome-dsh-plugin.com/plugins.json`](https://awesome-dsh-plugin.com/plugins.json)，CI 每日刷新。条目字段：`name/owner/url/page/category/description{en,zh}/npm/stars/downloads/install/added` —— 注意有 **npm downloads** 字段和每插件落地页（`/p/owner/repo/`），外加 badge/count 端点。
- **周边**：配套 agent 检索插件 [dsh-find-plugin]；立场是 client 无关（任何遵循协议的桌面端都能一键装这批插件）。

### 3.2 dsh-market（2,474★）— 应用内市场的标杆

来源：[README.zh.md](https://github.com/dsh-market/dsh-market/blob/HEAD/README.zh.md)、[dshmarket.com](https://dshmarket.com)

- **交互**：`dsh plugin --profile web add dshmarket` → 重启 → 设置 → Plugin Market。逛与搜（分类筛选、star 数、最热/最新排序、中英描述跟随界面语言）；App Store 式截图轮播（registry 里策展的截图零请求直显，没策展的在打开安装弹窗时自动从 README 抽取；图片仅从 GitHub 图床加载）；主题 Tab 点一下切换立即生效、主题互斥、跨重启保留、卸载即恢复。
- **数据策略**：每次打开实时请求 plugins.json，**不用过期缓存兜底**——失败给具体原因和耗时 + 重试按钮。
- **安装**：优先级见上文；大多数插件刷新页面即生效（不必整体重启）；更新/卸载/市场自更新都是一键。
- 明确「无遥测」。

### 3.3 whyihaveyou/dsh-suite（48★）— 数据质量最重的活目录（DSH Studio 当前默认目录源）

来源：[catalog-schema.md](https://github.com/whyihaveyou/dsh-suite/blob/main/docs/catalog-schema.md)、实抓 [data/plugins.json](https://raw.githubusercontent.com/whyihaveyou/dsh-suite/main/data/plugins.json)（样本已归档至 `.agent-workflows/dsh-plugin-marketplace-survey/output/`）

- **规模**：主目录 1,764 条 + watchlist 950 条；watchlist 带 triage 原因枚举：`蹭tag` / `工具链` / `占位`。
- **schema**（`_meta.schema_version 1.0`）：`id/name/npm/repo/category/description{en,zh}/author/stars/license/tags/dsh{minVersion,peerCordins,node}/compat{status,dshVersion,lastVerified,note}/install/featured/isOfficialBeta/language/evidence{level,l3Verified}/risk{installScript,networkEgress,shellAccess,noLicense}`。compat 枚举 `unknown|ok|broken|unmaintained`；evidence 分 L1–L3（风险扫描→人工验证）。
- **自动化**：star 由 GitHub GraphQL **每小时**刷新（`_meta.source: hourly refresh-stars`）；每日 compat 工作流三层验证（静态 peer 比对已实现，临时 profile 真实安装与组装检查 TODO）；README 表格由 `scripts/gen-readme.mjs` 从 JSON 生成，「绝不手改表格」——JSON 是单一真相源。
- **消费面**：内置商店插件 `@dsh-suite/plugin-manager`（设置 → Plugins → Store：逛目录、搜索、徽章、一键安装）；目录网站 [zh.html](https://whyihaveyou.github.io/dsh-suite/zh.html)；皮肤画廊（151 款）；脚手架 `npm create dsh-plugin`（tool/events/webui 三模板、next 标签锁版本、内置 `--verify` 冒烟测试）；投稿走 issue 模板。

### 3.4 bradeGithub/DSH-Plugins-Marketplace（146★）— 工程化细节最多的全量市场

- **索引**：CI 每 2 小时分页拉取 `topic:dsh-plugin` 全量 → 增量合并/去重/排除本体 → 提交 `registry.json`；终端读取顺序 jsDelivr CDN → raw → 搜索 API 兜底（缓存 10 分钟）。用户端零 API 调用零限流。
- **安装状态机**：`POST install` 返回 `done / awaiting-input / aborted / failed / manual` + 逐步日志；需要 API Key 时弹窗收集「提交材料并继续安装」。
- **已装识别**（防误判）：安装清单文件 → 目录启发式（`~/.dsh/skills/`、`.agent-presets/`、市场克隆缓存）→ 包名映射（含 scoped）→ **`package.json.repository` 双向归属校验**（既防同名异仓，也支持先装插件后装市场）→ 本体识别；官方 `@deepseek-ai/*` 自动排除。
- 另有通用 Skills 索引（`agent-skills ∪ claude-skills` 12,000+ 仓库）。

### 3.5 其他应用内市场一句话档案

| 市场 | 关键词 |
|---|---|
| [chnjames/dsh-plugin-market](https://github.com/chnjames/dsh-plugin-market) | 只经官方 `dsh plugin add/remove` 安装，绝不跑第三方脚本；Vercel 目录站 ⌘K/中英/亮暗；配置项极全（自建 registry URL、github topic + npm keyword 双源、cache TTL、`ui.showRiskLevel` 外观类/高权限启发式、`confirmBeforeInstall`）；多级回退 Vercel→jsDelivr→raw→包内快照→本地搜索 |
| [ouyangyipeng/dsh-marketplace](https://github.com/ouyangyipeng/dsh-marketplace) | 最完整的安全边界表：候选先进隔离临时项目、始终 `pnpm add --ignore-scripts`、严格 `owner/repository` 语法、patch/entry 路径必须留在包内、子进程逐参传递不拼 shell、写接口仅同源 loopback+进程 nonce、GitHub 数据按 React 文本渲染；manifest 原子替换、失败恢复旧 manifest；REST `/v1/bootstrap|catalog|install|remove` |
| [sandbaseai/dsh-plugin-store](https://github.com/sandbaseai/dsh-plugin-store) | Community/Installed 双 Tab；服务端标签过滤+分页（leaderboard 词表）；同源代理免 CORS；实时读取 Cordis Loader 清单；排序 rank/stars/**weekly growth**；工具 `store_search/store_catalog/store_install` |
| [AwesomeHou/dsh-plugin-marketplace](https://github.com/AwesomeHou/dsh-plugin-marketplace) | 确定性异步安装任务：阶段/百分比/速度/ETA/实时日志/可取消的 App Store 式进度条；npm 优先、monorepo `link:` 兜底 + 「运行时依赖可解析」真实验证；市场自更新横幅 |
| [DshMarketPlace/dsh-plugins-store](https://github.com/DshMarketPlace/dsh-plugins-store) | `/store` 斜杠命令在会话上层打开目录；捆绑一个 skill「教会 agent 去搜索而不是凭记忆报名字」；站点为每个插件手写页面；公共 `GET /api/v1/plugins` 同时喂站点/插件/独立 CLI |
| [2BingLing/dsh-market](https://github.com/2BingLing/dsh-market) | 五维评分（加权几何平均）：维护活跃30%/实用度25%/生态热度20%（star 对数归一 p99 + Wilson fork）/便捷度15%/信号质量10%，每条附解释；收录靠特征检测（SKILL.md / cordis 标记）过滤蹭 tag；DeepSeek 增量中文化；5-Tab 面板（推荐/搜索/收藏/已装/设置）+ 冷启动问卷 + 场景推荐（读会话上下文）+ AI 子代理代安装；整合包协议 `dsh.pack.json`（[dsh-bundler](https://github.com/2BingLing/dsh-bundler)） |

## 4. 横向对比

| 维度 | 社区主流做法 |
|---|---|
| 目录来源 | PR 精选（awesome-dsh-plugin）/ CI 定时扫 topic + 特征检测过滤蹭 tag（dsh.market、dsh-suite watchlist triage）/ 双源 github topic + npm keyword（chnjames） |
| 索引分发 | CI 生成静态 JSON：jsDelivr CDN（brade、chnjames 回退链）、GitHub Pages/Vercel 站、GitHub raw；每小时刷 star（dsh-suite GraphQL） |
| 安装通道 | npm 包 > Release 预构建 tarball > 源码下载；skill 型 git clone；monorepo link:；一律绕不开 `dsh plugin add` 或等价 profile 写入 |
| 安全机制 | `--ignore-scripts` 暂存（ouyangyipeng）、staging 先验后入 profile、原子替换+失败回滚、确认弹窗（chnjames confirmBeforeInstall）、风险启发式标签、evidence/risk 字段、「上榜≠安全审查」免责声明 |
| 更新与兼容 | compat 日检徽章 ok/broken/unmaintained（dsh-suite、AdamPlatin123）、updateAvailable 检测、市场自更新横幅、重启生效 vs 刷新即生效（主题类） |
| Agent 面 | 几乎每家都注册 agent 工具（search/detail/install/list_installed/update），DshMarketPlace 还捆教学 skill |
| 本地化 | 双语 description 成标配（awesome 注册表要求 en/zh 各 ≤140 字符）；DeepSeek 批量增量翻译（dsh.market） |

## 5. 对 DSH Studio 的借鉴点

对照本仓库现有实现（`plugins/plugin-marketplace/src/protocol.ts` 已具备 catalog 快照、inspect/prepare/preview/apply/undo 事务、source lock、三级 confirmation、protected 集合；客户端已有搜索/status tab/分类筛选/卡片网格）：

1. **兼容性信号前置**：我们目前只有 `updateAvailable`。dsh-suite 的 `compat.status` 徽章（ok/broken/unmaintained + lastVerified）让用户在点安装前就知道坏没坏——值得作为目录字段引入展示层。
2. **安装通道优先级**：npm → Release 预构建 tarball → 源码。预构建通道天然减少触发我们 `allow-build-scripts` confirmation 的次数，也更快。
3. **详情页富化**：截图轮播（策展优先、README 自动抽取兜底、仅 GitHub 图床）+ 截断式 README 摘要（chnjames 明确「设置 Tab 不做完整 Markdown 渲染」）是低成本高感知的改进。
4. **下载量维度**：awesome 注册表的 `downloads` 字段比 star 更能反映真实使用；排序/展示可加。
5. **已装识别加固**：若未来放宽目录来源，bradeGithub 的 `package.json.repository` 双向校验值得抄；我们的 source-lock（digest+commit pinning）本身已是生态最强方案。
6. **Agent 工具对称性**：社区市场普遍提供 search/install/list_installed 工具 + 教学 skill；我们的 `desktop_plugin_*` 已覆盖，但「教 agent 用检索代替记忆插件名」的 bundled-skill 模式可以借鉴。
7. **期望管理**：生态里主题/client 类插件「刷新即生效」，而我们是 apply 后重启激活——文档或 UI 应明确这一差异，避免用户以 dsh-market 体验为基准产生落差。
8. **目录治理参考**：单一 JSON 真相源 + 生成器产 README/站点（绝不手改表格）+ watchlist triage 枚举，是我们消费 `whyihaveyou/dsh-suite` 目录时可依赖的既有契约（`docs/catalog-schema.md` 即接口文档）。

## 6. 局限与备注

- 本机 `api.github.com` 直连超时：星数改为抓取 github.com 仓库页 HTML 的 `repo-stars-counter-star` title 值；dsh-suite 目录内 star 为其每小时 GraphQL 刷新值，两者可交叉印证（AdamPlatin123 1397、0xsline 909、bruc3van 278 两法一致）。
- 生态变动极快：dsh-market 在缓存的搜索元数据（2,206★）与本次实抓（2,474★）之间数日内即有增长；引用请注明抓取日期 2026-08-26。
- dsh-suite 文档中的部分计数（如「880+」「164 条」「官方 13,578★」）为其早期版本遗留，本文一律以当日实抓数据为准。

## 7. 来源

- 实抓数据：`whyihaveyou/dsh-suite data/plugins.json`（2,483,103 B，generated_at 2026-08-26T11:48Z）；`awesome-dsh-plugin.com/plugins.json`（2,231 条）
- 仓库：各表格行所列 GitHub 仓库及其 README（raw.githubusercontent.com 实抓或 web 检索摘要）
- 关键文档：[dsh-suite catalog-schema](https://github.com/whyihaveyou/dsh-suite/blob/main/docs/catalog-schema.md)、[create-dsh-plugin 模板](https://github.com/whyihaveyou/dsh-suite/tree/main/packages/create-dsh-plugin)、[dsh-market README.zh](https://github.com/dsh-market/dsh-market/blob/HEAD/README.zh.md)、[awesome-dsh-plugin contributing 评审标准](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- 星数：github.com HTML 抓取，2026-08-26
