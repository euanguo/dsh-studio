<p align="center">
  <strong>简体中文</strong> ·
  <a href="./usage.en.md">English</a> ·
  <a href="../README.md">返回 README</a>
</p>

# 安装、操作与排错

## 选择发行形态

- 需要完整本地工作台：安装 **DSH Studio**。
- 只需要浏览器交互：安装 **DSH Studio Web**，不携带 Electron。
- 纯终端交互：安装 **DSH Studio TUI**，不携带 Electron 或浏览器 UI。

完整版已经包含三种形态，因此安装一次后可以使用 `desktop`、`web` 和 `tui`。

## 安装完整版

### macOS

1. 从最新 Release 下载 DMG。
2. 将 **DSH Studio** 拖入 Applications。
3. 未公证的测试构建首次运行时，在 Finder 中右键应用并选择“打开”。

如确认文件来自项目 Release，但仍被 quarantine 阻止，可对实际下载文件执行：

```sh
xattr -d com.apple.quarantine ~/Downloads/DSH Studio-*.dmg
```

安装统一命令：

```sh
sudo ln -sf \
  "/Applications/DSH Studio.app/Contents/Resources/bin/dsh-studio" \
  /usr/local/bin/dsh-studio
```

### Linux

AppImage：

```sh
chmod +x DSH Studio-*.AppImage
./DSH Studio-*.AppImage
```

deb：

```sh
sudo apt install ./DSH Studio-*.deb
```

### Windows

运行 Release 中的 Windows 安装器并启动 **DSH Studio**。统一 CLI 位于应用
资源目录的 `bin\dsh-studio.cmd`，可以将该目录加入 `PATH`。

未签名安装器可能触发 Windows SmartScreen。确认文件来自项目 Release 后，选择
“更多信息”再选择“仍要运行”；安装过程可能请求管理员授权。

### Desktop 在线更新

在应用菜单中选择 **DSH Studio -> 检查更新…**。更新窗口只检查
`hust-open-atom-club/oh-dsh` 的 stable GitHub Release，不需要 GitHub 登录或
token。

- macOS、Windows 和 Linux AppImage 在下载并校验后可选择立即重启安装，或在
  下次退出时安装。
- `.deb` 会下载并打开系统的软件包安装器，不会绕过系统权限执行 `sudo`、`apt`
  或 `dpkg`。
- 更新器会使用系统代理设置；离线、代理认证、404、磁盘不足、校验失败、取消和
  重试都会在窗口中显示可恢复状态。校验失败时不会替换现有安装。
- 更新只替换应用程序，现有 DSH 数据、工作区设置、会话、已安装插件和 marketplace
  receipts 保留在原有数据目录中。

仅限签名的打包 Desktop 可自动更新。首次带更新器的 Release 之前安装的版本仍需
手动安装一次；本地开发构建和缺少当前平台安装包的 Release 会提供官方 Release
页面作为回退。

## 安装 Web-only

```sh
tar -xzf dsh-studio-web-*.tar.gz
cd dsh-studio-web-*/
./bin/dsh-studio web
```

Windows：

```bat
bin\dsh-studio.cmd web
```

常用选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `--host` | `127.0.0.1` | 监听地址 |
| `--port` | `3080` | 监听端口；`0` 使用随机端口 |
| `--data` | `~/.dsh-studio` | 三端共享的 DSH Studio 数据根目录 |
| `--channel` | `stable` | 选择 `~/.dsh-studio` 或 `~/.dsh-studio-dev`；`--data` / `DSH_STUDIO_HOME` 优先 |
| `--no-open` | 关闭 | 不自动打开浏览器 |
| `--trusted-host` | 无 | 增加可信 authority，可重复 |

等价环境变量包括 `DSH_STUDIO_WEB_HOST`、`DSH_STUDIO_WEB_PORT`、
`DSH_STUDIO_WEB_HOME` 和 `DSH_STUDIO_WEB_OPEN`。`DSH_STUDIO_HOME` 可以统一覆盖
Desktop、Web 和 TUI 的数据根目录。`DSH_STUDIO_CHANNEL` 在未指定绝对路径时
选择 `~/.dsh-studio` 或 `~/.dsh-studio-dev`。按 `Ctrl+C` 优雅退出。

不要在未配置访问边界时直接监听 `0.0.0.0`。对局域网开放时，应同时配置
`--trusted-host`，并由可信反向代理提供鉴权和 TLS。

## 安装 TUI-only

```sh
tar -xzf dsh-studio-tui-*.tar.gz
cd dsh-studio-tui-*/
./bin/dsh-studio tui
```

Windows 使用 `bin\dsh-studio.cmd tui`。TUI 需要真实交互终端；默认使用 alternate
screen，全屏选择、滚动和复制由上游 `dsh-TUI` 处理。

## 统一启动命令

```sh
dsh-studio desktop
dsh-studio gui
dsh-studio web
dsh-studio tui
```

- `desktop` 启动已安装应用；源码仓库中回退到 Electron 开发入口。
  正式安装包默认使用 `stable`（`~/.dsh-studio`），Dev DMG 在打包时固定使用
  `dev`（`~/.dsh-studio-dev`），`pnpm start` / `pnpm dev` 也默认使用 `dev`。
  可用 `--channel stable|dev` 覆盖。
- `gui` 是 `desktop` 的启动别名。
- `web` 启动 HTTP 服务并打印访问地址。
- `tui` 初始化独立 Profile，并在当前终端中附着运行上游 renderer。

TUI 常用选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `--cwd` | 当前目录 | Workspace |
| `--data` | `~/.dsh-studio` | 三端共享的 DSH Studio 数据根目录 |
| `--channel` | `stable` | 选择 `~/.dsh-studio` 或 `~/.dsh-studio-dev`；`--data` / `DSH_STUDIO_HOME` 优先 |
| `--resume` | 新会话 | 恢复指定 Session id |
| `--lang` | 上游设置 | `zh` 或 `en` |
| `--preset` | `standard` | 初始 Agent preset |
| `--inline` | 关闭 | 保留终端 scrollback，不使用 alternate screen |

## 图片识别

Desktop、Web 和 TUI 都会加载内置的 `@dsh-studio/vision`。图片粘贴、缩略图、附件保存
和提交全部使用 DSH 原生 attachment rail。DeepSeek V4 的模型元数据在 DSH 中仍标记
为 text-only，插件只在 Host 的最终图片能力校验处为 V4 放行，不接管输入栏，也不
创建第二套图片气泡或引用协议。Host 会先用配置的视觉后端描述这些原生图片附件，再
交给固定的 text-only 适配器序列化同一轮请求。`view_image` 仍可对明确给出的 Workspace
图片路径、HTTP(S) URL 或 image data URL 做 OCR、图表读取、物体计数、截图排错与布局分析。

在 Desktop 或 Web UI 中，复制一张 PNG、JPEG、WebP 或 GIF，把焦点放到消息输入框并
按 `⌘V`（macOS）或 `Ctrl+V`（Windows/Linux）。当前 DSH 输入栏会在输入框内部显示
原生缩略图，并负责删除、拖放、大小限制和提交；插件不会拦截这条流程。TUI 没有图形
化缩略图，直接在消息中提供 Workspace 内的图片路径或 HTTP(S) URL，即可调用同一个
`view_image` 工具。

默认后端使用智谱 `glm-4.6v-flash`。在原生的“设置 → 插件 → 插件配置 → Vision”卡片中，
先确认云端接口地址，再点击“获取智谱 Key”打开智谱控制台；复制回来的 Key 会以密码
输入框显示，并保存到共享数据根目录的凭据文件（默认 `~/.dsh-studio/.credentials.yaml`）：

```yaml
ZHIPUAI_API_KEY: your-api-key
```

凭据文件应保持仅当前用户可读，例如在 macOS/Linux 上执行
`chmod 600 ~/.dsh-studio/.credentials.yaml`。也可以在启动前 `export ZHIPUAI_API_KEY=...`。
旧版本使用的 `VISION_API_KEY` 仍会作为迁移回退读取。

后端和模型可在共享的 `~/.dsh-studio/settings.yaml` 中覆盖：

```yaml
dsh-studio-vision:
  baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
  model: qwen3-vl-flash
  apiKeyEnv: DASHSCOPE_API_KEY
  maxTokens: 2048
  timeoutMs: 60000
maxImageBytes: 10485760
```

卡片只显示云端接口地址、云端模型和一个隐藏的智谱 Key 输入框；Key 不会回显到设置快照。
重试、备用模型、超时、图片大小和本地 OCR/VLM 选项仍可由 Agent 或 `settings.yaml` 高级配置，
不要求用户重复填写多个 Key。Claude/Anthropic Key 属于对应模型提供方，不会被当作智谱 Vision
Key 使用。

使用本地 Ollama 时不要求密钥：

```yaml
dsh-studio-vision:
  baseURL: http://localhost:11434/v1
  model: qwen3-vl:4b
```

插件始终优先使用云端凭据，并对云端备用模型进行有上限的重试。如果云端被限流、不可用
或返回不兼容结果，会尝试配置的本地 OCR/VLM 模型；本地也失败后还会进行一次最终云端
恢复，再提示你检查 Vision 卡片、换一把云端 Key 或安装本地模型。`localModel` 就是用户
从本机 Ollama/LM Studio 兼容安装中选择的模型 ID；为空表示关闭本地回退。非本机端点才
需要配置 `localApiKeyEnv`。

```yaml
dsh-studio-vision:
  apiKeyEnv: ZHIPUAI_API_KEY
  retryAttempts: 3
  retryBackoffMs: 1000
  localBaseURL: http://localhost:11434/v1
  localModel: glm-ocr
  localFallbackModels:
    - qwen2.5-vl:7b
```

每个后端都会进行有上限的指数退避重试。两个后端都失败时，错误消息会提示用户检查
云端 Key，或安装/配置本地 OpenAI-compatible OCR/VLM 模型。插件不会在仓库中内置或
联网获取共享云端密钥；用户自己的授权凭据仍通过 DSH credentials 或配置的环境变量
提供。

本地图片路径只能位于当前 Session 的 Workspace 内，解析软链接后仍会检查边界；
远程 URL 或本地图片内容只会在调用 `view_image` 时发送给所配置的视觉端点。浏览器
附件按钮、粘贴和拖放都属于 DSH 原生图片输入；DeepSeek V4 的最终 admission check
由插件放行，其他模型仍遵循各自的 image-input 元数据。

## Desktop 操作

### 对话输入历史

焦点位于主对话输入框时，在第一行开头按 `ArrowUp` 可取回上一条已提交消息；在
最后一行末尾按 `ArrowDown` 可向后浏览，并最终恢复开始浏览前的草稿。多行输入中，
未处于这两个边界的方向键仍保持原有的光标移动行为。

历史按当前会话隔离，只包含已确认的用户文本消息，仅在本次应用运行期间保存在内存
中。输入框最多保留最近 100 条记录；在容量允许时，浏览到最早记录会按需加载更早的
会话消息。

| 操作 | macOS 快捷键 |
| --- | --- |
| 切换左侧栏 | `⌘B` |
| 切换底部 Terminal | `⌘J` |
| 切换右侧栏 | `⌥⌘B` |
| 打开 Review | `⌃⇧G` |
| 打开 Browser | `⌘T` |
| 打开 Files | `⌘P` |
| 新建 Side chat | `⌥⌘S` |
| 退出侧栏专注模式 | `Esc` |

设置页支持中英文、模型、权限、Agent preset、插件配置和 DSH Studio 皮肤。
设置弹窗会覆盖并虚化所有工作区和侧栏内容。

Web 与 Desktop 可在设置页选择皮肤。TUI 输入 `/theme` 可选择相同的 Deep
Current、Jade Circuit、Porcelain 和 Ember Dusk；选择立即生效并在重启后保留。

## 插件市场

插件市场使用 DSH Studio 的单一 canonical catalog 和单一事务 owner。打开市场后，
左侧是搜索、状态/分类/排序和虚拟化插件列表，右侧是详情、来源、兼容性、信任、
README 摘要和截图；整合包、观察区、自更新和进行中的进度也在同一面板中显示。

安装链路：

1. 选择插件或输入公开 GitHub `owner/repo`，先执行 `plan` 检查来源、精确 commit、
   channel、权限、兼容性、材料和风险。
2. 低风险且没有待确认项或配置材料的计划可直接 `Install`：先写 candidate Profile，
   校验通过后原子替换 live Profile，并保留一次 Undo/recovery；这条路径不会启动预览
   runtime，但仍会按需要重启 DSH。
3. 需要确认的计划会显示脚本、高风险、来源变化等逐项确认；需要 Key/token 时在市场
   内填写，secret 不会进入快照、日志或 Agent 返回值。
4. 也可以显式选择“先试装”。这会启动隔离 DSH runtime；不满意选择放弃，正式 Profile
   不变；满意后通过确认对话框应用。
5. 任何阶段都可以查看进度、ETA 和最近日志，并在可取消阶段取消；失败会回滚 candidate
   和 live Profile。应用成功后可使用 Undo 恢复之前的 Profile。

来源只接受可验证的精确事实：`github:<owner/repo>#<40 位 commit>`、
`npm:<package>@<exact semver>`，或 GitHub release host 上的
`tarball:<https-url>#<sha256>`。tarball URL 必须是无 query/hash 的 HTTPS
`github.com/.../releases/download/...` 或 GitHub release asset host。旧的 registry reader
和 `inspect`/`prepare`/旧 `preview` 命令不属于当前契约。

Agent 通过同一个 Host gateway 使用 `plan`、`execute`、`pack`、`provide`、`cancel`、
`discard`、`apply` 和 `undo`，与 UI 共享 source lock、风险确认、候选 Profile、预览、
重启和恢复语义；低风险 Agent 操作可以走相同的 direct fast path。

## 从源码启动与打包

```sh
git submodule update --init --recursive
pnpm install
pnpm run build:dsh
pnpm run build
pnpm run stage:dsh
export PATH="$PWD/bin:$PATH"

dsh-studio desktop
dsh-studio web --port 3080
dsh-studio tui
```

打包命令：

```sh
pnpm run dist:mac       # macOS 完整版
pnpm run dist:linux     # Linux 完整版
pnpm run dist:win       # Windows 完整版
pnpm run dist:web       # Web-only 轻量版
pnpm run dist:tui       # TUI-only 终端版
```

发布工作流在 GitHub Actions 的 macOS 签名/公证凭据和 Windows Authenticode
凭据齐全时生成正式签名包。缺少任一组凭据时，工作流会明确警告并降级生成 macOS
ad-hoc 签名包或 Windows 未签名安装器，而不会阻止 Web、TUI 和 Desktop 打包。
降级产物仅支持上文所述的手动安装，不能视为支持自动更新。启用正式签名需要配置
`MACOS_CSC_LINK`、`MACOS_CSC_KEY_PASSWORD`、`APPLE_ID`、
`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`、`WINDOWS_CSC_LINK` 和
`WINDOWS_CSC_KEY_PASSWORD`。安装包、内嵌或外置 blockmap、`latest*.yml` 元数据
仍会被严格校验，缺失时停止发布。可从 Actions 手动运行 Release workflow 做四平台
打包检查；手动运行只上传 workflow artifacts，不创建 GitHub Release。

## 数据与排错

Desktop、Web 和 TUI 默认共同使用 `~/.dsh-studio`，且不会加载 `~/.dsh` 中的
全局插件配置。三端分别使用 `profiles/desktop`、`profiles/web` 和
`profiles/tui`，但共享会话、凭据、皮肤和插件缓存；Electron 自身的数据
位于 `<DSH_STUDIO_HOME>/desktop`。可用 `DSH_STUDIO_HOME` 全局覆盖，也可用
`DSH_STUDIO_CHANNEL=dev` 或 `--channel dev` 切到 `~/.dsh-studio-dev`。Web/TUI 的
`--data` 只隔离当前进程。DeepSeek API key 可以在 Models 设置中配置，或写入
当前数据根下的 `.env`。

正式版、Dev DMG 与源码验证实例可以同时运行：正式版写入
`~/.dsh-studio`，Dev DMG 和 `pnpm start` / `pnpm dev` 写入
`~/.dsh-studio-dev`。两者 Profile、插件与工作区行为一致，只换数据根和单实例锁。
Dev 窗口标题带 `(Dev)`，Dev DMG 使用独立的 Dev app id 和 `DSH Studio-Dev` 产物名。
要让 Dev 实例读正式数据，启动时明确加 `--channel stable` 或设置
`DSH_STUDIO_HOME`。

首次使用共享目录时，Desktop 会从系统应用数据目录中的旧
`DSH Studio` 状态导入会话、凭据、插件与界面设置；Web 会导入旧
`~/.dsh-studio-web/dsh`、根级皮肤与侧栏偏好，以及当前数据目录下的 `dsh/`。
迁移只复制共享目录中缺失的数据，并保留旧目录用于回滚；已存在的新状态
不会被覆盖。

桌面端环境：从 Finder、Launchpad 或 `open -a "DSH Studio"` 启动时，macOS 和 Linux 不会自动加载终端的 Shell 配置，Desktop 会在启动时读取一次用户的 POSIX 登录 Shell 环境并按 `~/.zshrc` 等文件的变化自动失效缓存；Windows 使用 GUI 进程已经继承的用户与系统环境，并识别 `Path`、`PATHEXT` 和 `ComSpec`。用户可见的进程（应用内终端、Agent terminal、Git 与用户命令）以用户的 PATH 优先，应用自带的 Node 适配器只作为兜底；Marketplace 与插件预览仍使用应用自带的运行环境，以保证 pnpm 和插件构建一致。因此 `codex`、`pi`、`gh` 以及用户自己的 `node` 都可以直接使用。POSIX Shell 配置无法启动或超时时，Desktop 会回退到基础环境并把脱敏状态写入诊断日志；也可设置 `DSH_STUDIO_DISABLE_ENV_CACHE=1` 关闭环境缓存。Marketplace 的 GitHub credential helper 只对插件市场进程生效，普通终端和项目 Git 继续使用用户自己的 Git 配置与 macOS Keychain。

解释器变量边界：应用以自带 Electron 二进制兼任 Node 解释器（免带独立 Node），`ELECTRON_RUN_AS_NODE=1` 只存在于"以解释器身份拉起自家二进制"的启动环境里。运行时进程启动时会通过预加载脚本立即删除该变量，因此 Agent 会话及其工具 Shell 继承的环境只包含用户环境与 `DSH_*` 命名空间变量——Agent 代跑的任何命令（包括会打开窗口的 Electron 程序，如本仓库的 `pnpm run dev`）看到的都是干净环境。Marketplace 构建是唯一保留该变量的执行边界（其 pnpm 必须走共享解释器）。

排查顺序：

1. 运行 `dsh-studio --help` 确认 CLI 来源。
2. 运行 `dsh-studio web --help` 检查参数。
3. 运行 `dsh-studio tui --help`，再用 `dsh-studio tui --inline` 排除终端全屏兼容问题。
4. 使用随机端口验证：`dsh-studio web --port 0 --no-open`。
5. 检查 Profile 是否同时安装并启用了所需插件。
6. Desktop 启动失败时，从终端运行应用内 `bin/dsh-studio desktop` 获取日志。

架构与上游关系见[设计与插件边界](./design.md)。
