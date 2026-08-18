<p align="center">
  <strong>简体中文</strong> ·
  <a href="./plugin-marketplace-expansion-plan.en.md">English</a>
</p>

# Oh-DSH 插件市场扩展实施规划

> 状态：P0 已实现并进入静态验证；本文的 P1/P2 仍是后续规划。实现继续复用现有事务 owner，不启动真实 DSH 或执行真实插件安装。

## 1. 目标

把当前 Desktop-only、单 catalog、只能用 `pluginId` 的 marketplace，扩展为一个可审计的多来源插件入口，同时保留 Oh-DSH 现有的隔离 preview、风险确认、原子 apply 和 Undo。

完成后，用户可以：

1. 浏览内置、社区和用户添加的多个 catalog；
2. 直接输入一个公开仓库，而不要求它已经进入 catalog；
3. 查看 exact commit、manifest、patch、entry、脚本、release、风险和兼容性证据；
4. 对符合当前 DSH bundle 合同的仓库执行安装；
5. 在隔离 profile 中构建和启动 preview；
6. 在确认后原子应用，失败时恢复，或主动 Undo。

## 2. 强制验收目标

以下仓库不是示例，而是 P0 的强制验收 fixture：

- URL：`https://github.com/JUSTMONIKA2022/dsh-sandbox-escalation-fix`
- 验收 pin：`19f2cb4cecc178313d2f54458badfc1bcb8bc816`
- 本地审计 clone：
  `.agent-workflows/dsh-market-research/output/repos/sandbox-escalation-fix`

该 commit 的源码证据：

- `package.json:53-56` 声明 `dsh.bundle.patch: ./cordis.patch.yml`；
- `package.json:21-32` 声明 package entry；
- `package.json:45-48` 声明 `build`、`prepare`、`test`；
- `package.json:58-68` 声明 DSH peer dependencies；
- `package.json:70-86` 的开发依赖包含 DSH `0.1.0-rc.7`；
- `cordis.patch.yml:1-3` 插入 `sandbox-escalation-fix`；
- `src/index.ts:17-27` 暴露 bundle 的 Cordis `apply` 和依赖注入；
- README 声明支持 DSH `0.1.0-rc.5` 至 `rc.7`（`README.md:153-159`）。

### 2.1 必须通过的用户流程

在没有把该仓库预先写入 catalog 的情况下：

1. UI 或 Agent 输入完整 GitHub URL；
2. resolver 解析 owner/repo，并把默认分支解析为 exact 40 位 commit；
3. resolver 读取该 commit 的 `package.json` 和 `cordis.patch.yml`；
4. candidate 被判定为：
   - `mechanism: bundle`；
   - `execution: installable`；
   - `packageName: dsh-sandbox-escalation-fix`；
   - `manifestPath: package.json`；
   - `patchPath: cordis.patch.yml`；
   - `resolvedCommit: 19f2…c816`；
   - `installScripts` 至少包含 `prepare`；
5. 用户看到脚本原文、commit、manifest hash、patch hash、peer compatibility 和风险确认；
6. preview 将当前 profile 复制到 disposable candidate profile；
7. candidate 内以 `--ignore-scripts` materialize 依赖，只有在用户确认后才在受限 sandbox 中运行 `prepare`/build；
8. candidate DSH runtime 能加载 `sandbox-escalation-fix` 的 patch，并启动隔离 preview；
9. preview 期间 live profile、live `package.json`、live lockfile 和 live `node_modules` 不发生变化；
10. discard 后 candidate、临时 store、build 目录和临时状态被清理；
11. apply 后使用官方 DSH bundle/profile contract 运行；
12. apply 失败能恢复旧 profile；apply 成功后 Undo 能恢复 apply 前的 profile。

### 2.2 非 macOS 的明确结果

当前脚本 preview 使用 macOS Seatbelt。Linux/Windows 在没有等价 sandbox Adapter 前，不得静默执行 `prepare` 或 build：

- 可以完成静态检查并展示 candidate；
- 可以标记为 `scripted-preview-unavailable` / `blocked`；
- 不得伪装成已隔离安装；
- 后续加入 Linux/Windows sandbox 后，必须新增同一 fixture 的跨平台 contract test。

## 3. 设计不变量

这些规则比具体文件名更重要：

1. Desktop、Web、TUI 继续共享同一个 pinned DSH runtime；不引入第二个 Loader、runtime 或 profile 根目录。
2. 当前 DSH 可执行的安装合同只有 `package.json#dsh.bundle.patch` + `dsh.profile.bundles`。
3. `.dsh-plugin`、`repository-plugins` 和 `config.repositories` 在当前 pinned DSH 上只可用于诊断；不能生成可 apply plan。
4. Catalog trust、repository trust、代码风险和用户 approval 是四个不同事实，不能合并成一个 `trusted: boolean`。
5. Catalog 只能提供 metadata 和 admission evidence；它不能跳过 commit pin、manifest hash、脚本确认或 preview。
6. UI 和 Agent 必须提交同一种 `SourceRef`，得到同一种 `MarketplaceCandidate` 和 `MarketplacePlan`，调用同一个 transaction owner。
7. 所有写入必须先发生在 candidate profile；live profile 只能由 apply 的原子切换改变。
8. 第三方脚本、native code、动态下载和外部副作用必须显式展示边界；profile rollback 不等于外部副作用 rollback。
9. 公开仓库可检查不等于可以安装；只有 `execution === installable` 的 bundle candidate 可进入 apply。

## 4. 目标架构：一个深模块、两个来源入口

### 4.1 外部接口

新增一个深模块 `MarketplaceSourceResolver`，对调用者暴露小接口：

```text
resolveCatalogSource(source: CatalogSourceRef) -> CatalogSnapshot
resolveRepository(source: RepositorySourceRef) -> MarketplaceCandidate
makePlan(candidate, action) -> MarketplacePlan
```

复杂性隐藏在实现内部：GitHub raw/API、`gh` fallback、Git remote、schema、release、manifest、patch、entry、source lock 和风险分析都不能散落到 UI、Agent 和 transaction manager。

### 4.2 CatalogSource

```text
CatalogSource {
  id: string
  kind: "builtin" | "json" | "github-repository" | "github-topic-snapshot"
  locator: string
  label: string
  enabled: boolean
  priority: number
  trust: "builtin" | "reviewed" | "user"
  signature: { algorithm: "Ed25519", keyId: string, status: string } | null
  digest: string | null
  etag: string | null
  lastCommit: string | null
  lastSuccessfulFetchAt: string | null
  lastError: string | null
}
```

Catalog merge 要求：

- 记录每个 row 的 `catalogSourceId`；
- 相同 repository/package identity 不得静默覆盖；
- 高 priority 只影响展示选择，不得覆盖安全事实；
- stale cache 可以浏览，但 install 时必须重新确认 source/commit evidence；
- 内置 catalog 继续保留，不能因新增 scanner 而破坏旧三种 schema 的迁移读取。

### 4.3 RepositorySourceRef

第一阶段支持：

```text
RepositorySourceRef {
  input: "owner/repo" | "https://github.com/owner/repo" | "https://.../tree/<ref>/<subpath>"
  requestedRef: string | null
  subpath: string | null
  catalogSourceId: string | null
}
```

后续可增加 `git+https://...#<ref>`，但必须由独立 Adapter 解析；第一阶段不得接受 SSH、local path、任意下载 URL 或 shell 片段。

### 4.4 MarketplaceCandidate

```text
MarketplaceCandidate {
  identity: {
    repository: string
    subpath: string | null
    packageName: string
  }
  source: {
    kind: "catalog" | "direct-repository"
    catalogSourceId: string | null
    locator: string
    requestedRef: string | null
    resolvedCommit: string
    installSpec: string
  }
  manifest: {
    path: string
    hash: string
    version: string | null
    bundlePatch: string | null
    entryTargets: string[]
    patchHash: string | null
  }
  evidence: {
    license: string | null
    release: object | null
    compatibility: object | null
    filesPresent: string[]
    signature: object | null
  }
  buildScripts: Record<string, string>
  execution: "installable" | "guide-only" | "blocked"
  risk: {
    level: "low" | "elevated" | "high" | "blocked"
    reasons: string[]
    requiredConfirmations: string[]
  }
}
```

### 4.5 InstallSpec 不变量

- GitHub bundle 第一阶段规范为 `github:owner/repo#<40-char-sha>` 或等价的 exact `git+https` spec；
- 不接受 floating branch 作为执行 spec；branch/tag 只能作为 requested ref，必须先解析并锁定 commit；
- `installSpec` 必须经过 allowlist，不能包含 shell metacharacter、query、路径逃逸或未验证 subpath；
- apply 只把 spec 交给官方 DSH/pnpm-forward path；resolver 不直接执行 shell；
- `MarketplaceSourceLock` 绑定 `catalogSourceId + canonical locator + requestedRef + installSpec + resolvedCommit + manifestHash + artifactDigest`。

## 5. 分阶段实施

### P0-A：合同和数据模型

目标：先建立不可绕过的类型与测试 seam，不改变现有 UI 行为。

工作：

- 扩展 `protocol.ts`：`CatalogSource`、`SourceRef`、`MarketplaceCandidate`、`installSpec`、source lock v3、admission/result codes；
- command 从只收 `pluginId` 扩展为 `pluginId | sourceRef`；
- 保留旧 command 作为 migration compatibility，但新实现不得继续把 `pluginId` 当作唯一身份；
- `catalog.ts` 保留旧 schema 读取，同时保留 source id、release、package path、stars、license、signature、完整 install spec；
- 新建 Host-only resolver seam，并为 GitHub public Adapter、fixture Adapter 建 fake implementation；
- 明确 `repository/.dsh-plugin` 的 `blocked`/`guide-only` contract test。

完成标准：不运行第三方代码即可对强制验收仓库生成完整 candidate；错误 manifest、未锁定 ref、缺 patch、路径逃逸和脚本类型都有稳定 error code。

### P0-B：直接公开仓库 Resolver

目标：让强制验收仓库不依赖 catalog 也能进入现有 transaction。

工作：

- GitHub URL/slug canonicalization；
- commit resolution，优先 HTTPS/public API，不强制用户安装或登录 `gh`；
- exact commit 读取 root manifest、bundle patch、exports/entry；
- package name、version、peer DSH compatibility 检查；
- 构造 normalized installSpec；
- 计算 manifest/patch/artifact evidence；
- 识别 `prepare/install/postinstall` 并把原文带入 plan；
- 对 `.dsh-plugin` 仅返回兼容性说明，不生成可执行 plan；
- 直接仓库和 catalog row 使用同一 `MarketplaceCandidate`。

强制 fixture：

- `JUSTMONIKA2022/dsh-sandbox-escalation-fix@19f2cb4…c816` 必须生成 bundle/installable candidate；
- `package.json` 的 `prepare` 必须被识别为 script confirmation；
- `cordis.patch.yml` 必须在 candidate 中被验证为 root-relative、存在且可解析。

### P0-C：接入现有隔离事务

目标：不复制外部安装器，把 candidate 接入现有 `PluginMarketplaceManager`。

工作：

- `inspect/prepare` 接受 candidate，而不是只从 catalog 查 row；
- bundle materialization 使用 exact installSpec/commit；
- `pnpm install --ignore-scripts` 与显式脚本 build 分离；
- 脚本只在用户确认后、可用 sandbox 内执行；
- candidate runtime 必须在 apply 前启动并通过 runtime readiness；
- apply 前再次检查 candidate source lock、catalog digest、manifest/artifact hash；
- 保留 profile rename、failed-candidate、Undo 和 re-home node_modules；
- 删除产品代码中“repository plugin 可执行”的假路径，改为明确 blocked/guide-only；
- 为真实 pinned DSH CLI/profile loader 增加 contract test，不能只依赖 FakePlatform。

强制 fixture 验收：

- preview 成功启动 `dsh-sandbox-escalation-fix`；
- preview 中能观察到 `sandbox-escalation-fix` patch entry；
- live profile digest 在 discard 前后不变；
- apply 失败时旧 profile 可启动；
- apply 成功后 Undo 恢复旧 profile；
- 所有 build 临时目录位于 transaction root 内。

### P0-D：统一 Human/Agent approval

目标：UI 与 Agent 的风险策略只保留一个 Host decision。

工作：

- Host 生成 `requiredConfirmations`、risk facts 和 approval summary；
- UI `RiskConfirmation` 和 Agent `tools/pre-execute` 都消费同一份 decision；
- Agent 不得通过 gateway 直接跳过 source-change/script/high-risk confirmation；
- apply/recover 的重启 deferred 语义保持不变；
- approval 不落盘为永久 allowlist。

### P1-A：多 Catalog、严格 schema 和 scanner

目标：把 w211 的证据能力作为一个可选 source Adapter，而不是替换现有 catalog。

工作：

- catalog source CRUD、priority、merge/dedupe、source status UI；
- strict schema、canonical digest、bounded payload、ETag、LKG cache；
- topic scanner 的增量 state、1000-result window bisection、stable repository id；
- pinned tree one-click eligibility proof；
- compatibility/validation/risk evidence；
- optional pack discovery，逐项 plan，不提供不可回滚的“整组安装”。

### P1-B：签名、Provenance 和 release

目标：把“看起来可信”与“可证明来源”分开。

工作：

- Ed25519 trusted key 配置和签名状态；
- revision monotonicity、同 revision collision 拒绝；
- trusted publisher 和 manual review gate；
- Marketplace-installed provenance；
- `up-to-date/update-available/diverged/not-in-catalog` 状态；
- release `.tgz`、SHA-256、release channel、deprecated/yanked/revoked；
- release candidate 仍进入现有 preview/apply，不得新增 mutation path。

### P1-C：Generation/readiness recovery

目标：补齐重启、崩溃和候选 profile 未确认的恢复能力。

工作：

- `current/previous/pending/failed` generation；
- candidate prepared/ready/booting/current 状态；
- launcher PID/boot token/runtime-ready token；
- DSH 启动失败自动回到 previous；
- failed generation 保留原因和事件；
- migration 必须幂等、非破坏、可从旧 marketplace.json 恢复。

### P2：生态和体验

- Agent detail/manual guide；
- dependency graph、compatibility successful runs、composition preflight/recommend；
- non-executable repair preview；
- freshness、Wilson rating、categories、packs/recipes；
- operation history、profile selector、source history；
- Linux/Windows 的实际 sandbox Adapter；如果没有 Adapter，继续 fail-closed，不降低安全级别。

## 6. 测试计划

### Contract tests

- `resolveRepository(owner/repo)` 不依赖 catalog；
- exact commit 和 requested ref 的区别；
- `dsh.bundle.patch` 可加载；
- `.dsh-plugin` 只能 blocked/guide-only；
- normalized installSpec 不含 shell/path escape；
- source lock v3 migration。

### 强制 fixture tests

使用 fixture commit `19f2cb4cecc178313d2f54458badfc1bcb8bc816`：

1. direct URL → candidate；
2. candidate → manifest/patch/script evidence；
3. candidate → plan；
4. plan → script confirmation required；
5. confirmed plan → isolated preview；
6. preview loads Cordis patch and starts; 
7. discard leaves live profile unchanged；
8. apply atomic swap；
9. failed apply restores old profile；
10. Undo restores previous profile；
11. changed manifest at same commit is rejected；
12. branch/tag input is stored as requestedRef but execution uses resolved SHA。

### Security tests

- catalog payload size/timeout/ETag/cache source binding；
- signature invalid/unknown key/downgrade/collision；
- path traversal/symlink/patch escape；
- scripts absent vs present；
- protected plugin and package identity；
- Agent/UI approval parity；
- process restart during apply；
- preview cleanup after timeout/failure。

### Platform tests

- macOS arm64/x64：scripted preview must run inside Seatbelt；
- Linux/Windows：没有 sandbox Adapter 时必须稳定 blocked，不得执行脚本；
- all platforms：static manifest inspection and guide-only flow remain available。

## 7. Done 定义

只有同时满足以下条件才可声称“支持任意公开 bundle 仓库”：

- direct URL 不要求 catalog membership；
- exact commit 和 installSpec 可复现；
- bundle manifest/patch/entry/peer compatibility 已验证；
- script/build 具有显式 consent 和隔离执行；
- preview 能运行而不改变 live profile；
- apply/rollback/Undo 都有真实 contract test；
- Agent 与 UI 风险决策一致；
- 当前 pinned DSH Loader 能真正加载结果；
- 强制 `dsh-sandbox-escalation-fix@19f2cb4…c816` 用例通过；
- `.dsh-plugin` dead path 不再被标成可安装。

## 8. 明确不做

- 不恢复已被当前 DSH 移除的 repository-plugin loader；
- 不引入 `@omdsh/runtime` 或第二套 profile/runtime；
- 不执行任意 `install.sh`、`install.ps1`、curl pipe 或动态下载；
- 不用 topic、stars、catalog listing 替代 manifest/commit/risk evidence；
- 不让 Web/TUI 在没有实际 Host transport 时伪装出完整 marketplace；
- 不把 profile rollback 描述成外部副作用 rollback。

## 9. 参考代码

- Oh-DSH：`plugins/plugin-marketplace/src/protocol.ts`、`catalog.ts`、`host/platform.ts`、`host/transaction-manager.ts`、`src/marketplace-tools.ts`、`plugins/plugin-marketplace/src/host/agent-gateway.ts`。
- w211：`src/catalog.ts`、`src/catalog-client.ts`、`src/catalog-query.ts`、`src/profile-operations.ts`、`src/agent-tools.ts`、`scripts/plugin-marketplace-scan.ts`。
- omdsh：`dist/registry.mjs`、`dist/management.mjs`、`dist/policy.mjs`、`dist/generations.mjs`、`dist/agent-ecosystem.mjs`。
- 强制 fixture：`https://github.com/JUSTMONIKA2022/dsh-sandbox-escalation-fix`。

未来若移植具体代码，保留相应 MIT LICENSE、版权头、原始链接和 adapted-from 说明；本规划只借鉴行为和接口，不等于复制第三方实现。
