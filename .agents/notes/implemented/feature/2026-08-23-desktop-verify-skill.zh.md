# Agent Note: 桌面端自验证统一走 chrome-use

Status: implemented

[English](2026-08-23-desktop-verify-skill.md) | 中文

## Problem

DSH Studio 有桌面（Electron）界面面，其功能大多对模型可见：左栏、工作台
surface、diff/评论栏、插件市场、设置。功能改动后，团队希望 agent 启动 DEV
桌面端、连接它并端到端验证每个功能。此前的尝试漂移成了手写的一次性脚本直接
戳 UI（当天临时写的 click/typing/eval 载荷），非通用、短命，而且绕过了已装
浏览器自动化技能自带的 accessibility-tree 快照与回归套件设施。也没有一个持久
的地方记录"把 CDP 自动化挂到这款特定 Electron 应用上"的踩坑，所以每个 agent
都从零重新解决同样的发现过程。

## Decision

一个仓库自有的技能 [`dsh-desktop-verify`](../../../skills/dsh-desktop-verify/SKILL.md)
管辖 DEV 桌面端的自验证。它通过仓库自带启动器（`pnpm run dev`，本就强制
`DSH_STUDIO_CHANNEL=dev`，并通过官方留的 `DSH_STUDIO_ELECTRON_ARGS` 开口开启
CDP）启动 DEV 渠道，用已安装的 `chrome-use` CLI 经 CDP 连接，并要求**一切 UI
交互与断言都复用 chrome-use 自带能力**——snapshot/refs、find、
click/fill/type/press、wait/expect、eval、screenshot/record/HAR，尤其是经
`chrome-use test <suite> --session <name>` 的可重跑 YAML 套件——而不是自写
一次性功能触发脚本。技能唯一自有的仓库脚本是进程生命周期 helper
（`scripts/ensure-dev-desktop.mjs`：ensure/status/stop/logs），它绝不驱动任何
功能；应用自带的 dev watcher 会在主进程 bundle 变化时重启 Electron，所以技能
也写明了三种重载路径（客户端 HMR、Electron 重启、DSH Runtime 重启），并要求
每种之后都重新发现目标并重跑套件。

自我改进是硬性要求而非建议：每个踩坑都追加进技能随仓库跟踪的
`references/PITFALLS.md`（带日期的条目：症状/根因/修复/来源）；SKILL.md 描述
的步骤错了就修订它；改变行为或契约的持久改动要补 Agent Note 三件套。技能默认
只动 DEV 渠道（`~/.dsh-studio-dev`），绝不碰已安装的生产版（`~/.dsh-studio`）。

## Alternatives considered

**写脚本直接驱动功能。** 否决：它们重复实现了 chrome-use 已有的快照/ref 校验
与 console/network 捕获，随版本和 ref 变化而腐化，也永远收敛不成可重跑的回归
覆盖。套件引擎把每次功能检查变成持久用例。

**生命周期全交给临时 shell 一行流。** 单实例锁与"重启后 daemon 失效"这类失败
模式足够隐蔽，一个经测试的小 helper 包装官方 dev launcher 就能显著减少 agent
重复犯错；其余一切仍归 chrome-use。

**踩坑只记 Agent Note。** 对技能的核心循环否决：踩坑在运行中途就要查，必须随
技能本身携带，且任何未来 agent 在不走单独 notes 工作流的情况下也能更新。

## Consequences

DEV 桌面功能验证现在是一条确定性闭环（启动 → 连接 → 快照 → 套件 → 重启 →
重新发现 → 套件），完全构建在已装自动化技能的能力之上，证据落在 gitignored
的 `tmp/desktop-verify/`。随仓库跟踪的踩坑台账缩短下一位 agent 的预热时间。
技能与其套件随仓库版本化，因此贴近 CI 的验证与 agent 自检都可复用。helper 必须
保持对功能无感，agent 也要在 chrome-use 动词已覆盖某个步骤时克制住不写新的触发
脚本——PITFALLS 台账就是执行记录。
