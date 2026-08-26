# bump-runbook — DSH pin 半自动升级手册（leaf-4.2）

本手册与 `scripts/bump-dsh.mjs` 的步骤一一对应。上游 DSH 钉版的唯一可写事实源是
`config/dsh-dependencies.json`（leaf-4.1）；操作者先更新其中的 `runtime` 五字段
（package/version/integrity/tarball/packageManager，数据取自 `npm view @deepseek-ai/dsh@<v>
dist.integrity / dist.tarball` 与上游 packageManager 钉版），然后由本脚本把其余五个下游
事实逐步对齐。脚本永不 commit、永不触碰 `dist/`、`.stage/`、`release/` 与缓存目录。

## 步骤与脚本对应关系

| # | step id | 手册五步 | 前置校验（preflight） | 校验失败的结构化冲突 | 动作（apply 模式） |
|---|---|---|---|---|---|
| 1 | `facts` | dsh-source.json 字段重生成 | `dsh-source.json` 必须逐字段等于 `deriveDshSource(configFacts)` | `{step:'facts', …, file:'dsh-source.json', fix:'run node scripts/sync-dsh-dependencies.mjs'}` | 调用现有生成器 `scripts/sync-dsh-dependencies.mjs`（不复制其写入逻辑） |
| 2 | `lock` | lock yaml 就位 | `scripts/dsh-runtime-<version>-lock.yaml` 存在，且与 `.cache/dsh-source/npm-<version>/assembly/pnpm-lock.yaml` 逐字节一致 | `{step:'lock', actual:'missing'\|"differs (a vs b chars)", …}` | 从缓存 assembly 复制放置（stage-dsh 冻结安装正是消费此文件） |
| 3 | `patches` | patch 重钉验证 | 每个 `patches/dsh-runtime/*.patch` 先过结构校验（复用 `dsh-runtime-patches.mjs` 的 validatePatchPath/validatePatchSource），再对 `.stage/dsh-runtime` 的 layout 包做 `git apply --check` 前向+反向探测；前向通过=待应用、反向通过=已应用，**两者皆败=必须人工重钉** | `{step:'patches', actual:<git stderr 首行>, fix 含 minified 目标行片段}`（片段由 `patchTargetSnippet` 从首 hunk 旧侧内容在 client.js 中定位截窗） | 无自动改写；冲突时给出重锚上下文，由操作者重新生成 diff |
| 4 | `selectors` | selectors 重生 | `plugins/desktop-skins/src/client/generated-selectors.ts` 的 `// DSH revision:` 标记等于当前可解析 DSH 源的标记（npm+web 产物在场=`assembly`，git=`revision 前 12 位`，`DSH_SOURCE` 环境变量优先）；**无本地锚点时跳过（与 generate-skin-selectors 的跳过条件一致，不算冲突）** | `{step:'selectors', actual:'records <marker\|(none)>', fix:'run pnpm run generate:selectors …'}` | 有锚点时调用 `scripts/generate-skin-selectors.mjs` 重生成；无锚点时打印延迟指令 |
| 5 | `types` | npm types sandbox | `.cache/dsh-source/npm-types/package.json` 在场，且每个 typePackages 顶层包 devDependencies 版本 == 钉版 | `{step:'types', actual:'<pkg>@<installed\|missing>', fix:'run pnpm run build:dsh'}` | 操作者执行 `pnpm run build:dsh`（联网安装+tsconfig 重写属重型判断步骤，脚本只校验其结果） |

## 用法

```bash
# 干跑：输出全部步骤计划并运行所有只读前置校验；保证零文件改动
node scripts/bump-dsh.mjs --dry-run [version]
#   → 无冲突：stdout 以 BUMP-DRYRUN-OK 结束，exit 0
#   → 有冲突：stderr 打印 {step,expected,actual,file,fix}[] JSON，exit 1

# 应用模式：任一 preflight 冲突存在时拒绝一切改动（BUMP-APPLY-REFUSED）；
# 否则执行安全本地步骤（facts 重生成、lock 放置、有锚点时 selectors 重生成），
# 并打印重型步骤的操作者命令清单（build:dsh / stage:dsh / generate:selectors）。
# 永远不会 git commit/add。
node scripts/bump-dsh.mjs
```

## 结构化冲突报告约定

```json
[
  {
    "step": "patches",
    "expected": "git apply --check succeeds forward (or the patch is already applied) against the staged dsh-client-ui-layout/lib/client.js",
    "actual": "error: patch does not apply",
    "file": "patches/dsh-runtime/ui-layout-independent-columns.patch",
    "fix": "re-pin the patch against the new bundle; target context: <client.js 片段>"
  }
]
```

- 字段恒为五个非空字符串；`step` ∈ `facts|lock|patches|selectors|types`。
- 报告以 JSON 数组整体打印（stderr），可直接管道到 `jq` 或存档。
- 三类必测 fixture（lock 失配 / patch 前向+反向均失败 / selectors stale）见
  `tests/bump-dsh.test.ts`。

## dry-run 证据约定

1. 干跑前记录基线：`git status --porcelain | sort > /tmp/bump-before.txt`。
2. 运行 `node scripts/bump-dsh.mjs --dry-run > /tmp/kr-bump.log 2>&1; echo $?`
   —— 期望 exit 0 且日志以 `BUMP-DRYRUN-OK` 结尾。
3. 运行后复核零改动：`git status --porcelain | sort > /tmp/bump-after.txt &&
   diff /tmp/bump-before.txt /tmp/bump-after.txt` 必须为空。
4. 将第 2 步完整 stdout/stderr 存档至 `.agent-workflows/kernel-refactor-plan/logs/`
   （agent-only 目录，不入提交），作为 leaf-4.2 G3 与 node-4 N4.3 的证据样例。

## 升级全流程速查（操作者视角）

```bash
# 0. 更新唯一事实源 config/dsh-dependencies.json 的 runtime 五字段
# 1. 干跑确认计划与冲突
node scripts/bump-dsh.mjs --dry-run <new-version>
# 2. 应用机械步骤
node scripts/bump-dsh.mjs
# 3. 重型步骤（脚本清单会再次打印）
pnpm run build:dsh && pnpm run stage:dsh && pnpm run generate:selectors
# 4. 终验
node scripts/bump-dsh.mjs --dry-run   # 期望 BUMP-DRYRUN-OK
pnpm run typecheck && pnpm test       # 全量回归（按仓库门禁另行执行）
```

> 注意：selectors 的权威重钉依赖带 web 构建产物的 DSH 源（`.stage` 后的
> `@deepseek-ai/dsh-web-frontend/dist/assets` 或 git checkout）。纯 npm 钉版且本地无
> 产物时该步被显式延迟并在应用模式中提示，这与 `generate-skin-selectors.mjs
> --check --if-present` 的跳过语义一致。
