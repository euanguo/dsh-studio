# 更新日志 / Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本遵循 SemVer。
English version: [CHANGELOG.en.md](./CHANGELOG.en.md)

## [Unreleased] — 自 `v0.1.2` 起（分支 `feat/desktop-verify-skill`）

- 范围：`v0.1.2..HEAD`（`3e28cb0..6728fb7`），2026-08-22 至 2026-08-25
- 规模：92 个提交，478 个文件变更，+30,954 / −18,321 行

本版的核心是新能力 **WorkTree 编排与跨项目委派**：功能落地后在 DEV 渠道经历了一轮
完整的实机验证与打磨循环，本文按发布后的最终形态描述，不区分过程中的中间提交。

---

### WorkTree 编排与跨项目委派（新能力，默认关闭）

围绕 WorkTree 引入一套严格限定的编排网关，并把两种能力分开授权：

- **拓扑与生命周期工具**：`list` / `branches` / `status` / `create` / `remove`，
  经 `agentWorktreeTools` 开关启用。
- **跨项目委派工具**：`delegate` / `status` / `wait` / `stop` / `result`，由独立的
  `agentWorktreeDelegationTools` 开关单独授权（默认关闭）——把任务交给另一个
  WorkTree 中的独立 Agent 会话，是比检查本地 worktree 更重的能力。
- **结果回流**：子任务的进度与结果以结构化通知回传到发起会话；回调摘要对齐上游
  通知长度上限，已结算的委派记录自动修剪，避免无限累积。
- **委派即普通会话**：被委派的会话归入其所属 WorkTree 的分组行，可以像任意会话一样
  打开和继续对话；委派深度有硬上限，防止链式自我扩散。
- **可靠性**：委派等待能可靠观察到任务结算；工作区注册失败时自动回收已创建的会话，
  不留孤儿；停止操作与任务启动之间的竞态安全；模型提供的 branch/base 参数在执行前
  校验，拒绝形如选项的注入输入；无 upstream 或 detached HEAD 的 worktree 状态查询
  正常工作。以上场景均有回归测试覆盖。

---

### 桌面界面与交互重构

对右侧栏与中心表面的一次整体翻新：

- **划词操作条**：在文件、diff 与提交历史表面选中文字即浮现统一操作条——加入会话
  （附最近优先的会话选择器）、在侧边聊天中提问、完整评论卡片、行内编辑指令、复制
  引用；引用以斜杠 chip 形式落入输入框。
- **悬停评论统一**：pierre 文件查看器、编辑器、单文件 diff 与 diff-all 共用同一套
  gutter "+" 悬停评论交互；评论升级为 v2 模型（锚点路径 + 行区间 + 内容哈希、可选
  分支标记、解决生命周期），支持 KaTeX 公式，旧评论自动迁移。
- **滚动与工具条契约**：ScrollArea 收敛为唯一实现，配浮动细滚动条；画布类表面四边
  贴边、列表类表面显式内缩；SurfaceToolbar 统一接管标题/meta/小 chip 的槽位排版；
  ToolbarAction 成为 28×28 ghost 图标按钮基类。文件表面的查看/编辑收敛为单个图标
  切换（自动保存、Mod+S 与切换退出落盘仍是唯一写路径）；浏览器地址栏重建为 omnibox，
  回车即导航。
- **会话感知**：折叠的工作区集合行以呼吸点提示其中隐藏的活动会话；会话标签页使用
  对话图标并在会话活跃时切换官方 StateDot；子代理会话不再出现在中心标签页；平铺
  会话列表改为虚拟化渲染，跨工作区大量会话不再拖慢界面。
- **文件表面与右栏布局**：Files 搜索框与内联新建行适配官方 Input 的包装结构——
  搜索框占满可用宽度，新建行呈现为扁平的树行样式；工作区根目录下的创建、重命名、
  复制与删除会立即刷新目录树；右栏最大宽度从固定 640px 放宽为窗口宽度的 75%
  （220px 最小值不变），大屏并排工作更从容；桌面壳层移除侧栏顶部的品牌行，回收其
  占用的空间（Web/TUI 保持官方品牌不变）。
- **打开管线统一**：所有表面的打开动作经过同一决策表，一致遵守 centerPreviewTabs
  偏好；Git review 面板边距、工具菜单行宽、左右栏 2px 行距节奏等布局细节全部对齐。
- **插件市场**：客户端重写为 zustand store 并接入宿主变更推送通道；后台变更不再
  卡死进行中的操作，筛选条件在关闭后保留。

### 设置体验

- 新增 **Agent 能力设置页**：模型可见的能力开关与 Source Control AI 入口独立成页，
  页面级重置语义清晰。
- Side panel 设置按「布局 / 打开行为 / Agent 能力」重新分组；此前藏在功能齿轮弹窗里
  的 html sandbox、subagent/jobs 自动打开开关上浮到对应分区，浏览器 HTTP/HTTPS 拦截
  拆分为可分别控制的子开关。
- Source Control AI 面板并入通用 settings seam，删除专用 RPC；清理了四个从未生效的
  遗留偏好字段。

---

### UI 状态持久化迁移

左栏视图状态、中心表面打开集、侧栏 chrome/布局以及插件打开标记，从浏览器 localStorage
迁移到宿主存储域 **`dsh_studio_ui`**（zod 表结构，经官方 storageDomain 门禁读写），
客户端带内存回退与失败重试。表结构经单一递归路径派生，嵌套对象、可空与可选标记在
所有层级生效；域打开失败输出可见日志，事故形态由回归测试锁定。**注意**：旧
localStorage 数据一次性弃用，升级后首次启动侧栏布局与打开状态回到默认值。

---

### 桌面运行时

- **用户环境「用户优先」解析并缓存**：用户可见的子进程优先使用登录 shell 的 PATH
  （捆绑 Node 作兜底），marketplace 预览保持捆绑优先以保证构建一致；解析结果缓存在
  DSH 数据根下并按平台/shell/rc 指纹失效，排除 SSH_AUTH_SOCK 等会话变量。
- **平台适配器拆分**：POSIX 登录 shell 探测与 Windows GUI 环境处理各自独立成适配器，
  共享门面不变，Windows Path/PATHEXT/ComSpec 有回归覆盖。
- **解释器边界治理**：`ELECTRON_RUN_AS_NODE` 不再泄漏进 agent 工具 shell——agent 启动
  的 Electron 应用（包括 `pnpm run dev`）不会再静默退化为纯 Node 模式；附带治理守卫
  测试防止回归。

---

### 工程与架构（面向贡献者，无行为变化）

- **样式体系 CSS Modules 化**：lightningcss 引擎驱动的插件样式管线（per-file 哈希
  scoping），生成的 class map 类型安全，构建期 drift gate 保证 styles.ts 与源 CSS
  同步；shared ui.css 拆为保序切片，marketplace / skins / pinned-summary 样式外置。
- **模块重组**：`@dsh-studio/shared` 按 git / contracts / runtime / terminal 分组，
  capabilities 按 terminal / worktree / routes 分组并把路由表拆为独立 handler 模块；
  十余个千行级组件系统性拆分（WorkspaceBrowser、SideToolsPanel、settings 区块、
  marketplace client 等），`src/` 命令白名单、channelNames、启动参数解析单一来源化。
- **依赖收敛**：clsx / papaparse / pathe / lightningcss 替换四处手写实现；parser 与
  state 代码保持手写的决策均有记录依据。
- **守卫与清理**：构建期校验 shared exports map 完整性；移除底部终端 dock 残留、
  兼容 shim 与零消费者导出。

---

### 文档与治理

- 数据/状态纪律落地：六条 spec 条目（S1–S6）、三个 CI 守卫脚本、AGENTS 与
  plugins/AGENTS 数据纪律章节，设计文档新增双语数据流章节。
- `docs/` 目录全量纳入版本管理；新增持久化架构、交互模型、评论架构、workbench
  架构与 ui-chrome 存储方案五篇文档，中英双语同步维护。

### 开发与验证工具

- 新增仓库自有技能 **dsh-desktop-verify**：通过 dev launcher 启动 DEV 桌面、经 CDP
  驱动 chrome-use 做端到端自验证，内置冒烟套件与强制更新的踩坑台账（自改进闭环）。
  仅影响 DEV 渠道（`~/.dsh-studio-dev`），不触及已安装的生产应用。

---

### 升级注意事项

1. 旧 localStorage 中的 UI chrome 状态会被丢弃一次：首次启动侧栏布局/打开状态回到
   默认值。
2. 底部终端 dock 保持移除状态（残留模块已彻底清理）；如需恢复请参考 git 历史。
3. WorkTree 编排与委派默认关闭：需要分别在设置中启用 `agentWorktreeTools` 与
   `agentWorktreeDelegationTools`。
4. 文件表面的查看/编辑切换与浏览器地址栏交互有变化：Save/View 胶囊按钮与浏览器
   Go 按钮已删除，写路径收敛为自动保存 / Mod+S / 切换退出落盘，导航为回车触发。
