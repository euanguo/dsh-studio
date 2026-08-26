# ADR: 市场目录分页延迟（leaf-P2 裁决 = ADR 路径）

日期：2026-08-26 · 状态：接受 · 决策者：score-uplift leaf-P2

## 背景

三路深审将"目录全量拉取"列为性能维度候补项。调研定性：

- 目录源是**单个静态文件** `data/plugins.json`（locator
  `whyihaveyou/dsh-suite/data/plugins.json`），经
  `platform.ts loadCatalog()`（:454-516）从 raw.githubusercontent.com **整体拉取**，
  随后 `parseMarketplaceCatalog` 校验并整体写入 `catalog-cache.json`。
- 该源**不存在分页 API**：GitHub Raw 只能整取一个文件；`per_page` 类参数只存在于
  GitHub REST 列表端点，与此目录格式无关。要分页就必须先在上游仓库改造出
  index+shards 的目录格式——跨仓库契约变更，超出本仓一片叶子的边界。
- 现有传输缓解已在场：`if-none-match` etag 条件请求（304 时零正文刷新，
  platform.ts:498-508）、TTL 本地缓存、刷新失败时陈旧缓存回退（:487-490）。

## 实测数字

- 本机 DEV 数据根 `catalog-cache.json` = **1,983,661 字节（≈1.9 MB）**，
  含 ~1761 个目录条目。
- 解析后常驻堆约数 MB（桌面宿主进程），相对 staging 运行时预算
  （290 MiB，scripts/stage-dsh.mjs 硬闸）可忽略。
- 用户可感知的首开成本 = 一次 1.9 MB CDN 拉取（后续 304 零载荷）；无逐条
  N+1 网络放大。

## 决策

不在本仓实现 host 分页。客户端 DOM 成本（真正的卡顿源）由 **leaf-P1 的
react-virtual 虚拟化**在正确层级解决；host 保持单文档 + etag/304/TTL 模型。

## 复审触发条件（任一满足即重开）

1. 目录体积 > **5 MB** 或条目 > **10k**；
2. 上游目录迁移为可分页 API / index+shards 格式；
3. 出现低内存运行目标（如 TUI/嵌入式宿主共用此加载路径）；
4. etag 刷新因上游文件抖动频繁失效导致 1.9 MB 反复重拉。

## 影响

- 不改 `github-source-adapter.ts`（其职责是插件安装源解析，与目录无关）。
- 不新增 tests/catalog-paging.test.ts（无可驱动行为）。
- 性能维度得分提升由 P1 承担；本 ADR 记录 host 侧"为什么不分页"的完整论据。
