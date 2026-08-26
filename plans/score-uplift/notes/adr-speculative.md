# ADR: 投机面 keep-or-cut 裁决（score-uplift leaf-M3）

日期：2026-08-26 · 裁决：**CUT（全部裁除）**

## 背景

三路深审（维度 B/A）指出两处"诚实标注的休眠代码"持续收取维护税，违反仓库
AGENTS.md 的 no-speculative-generality 纪律。驱动者预裁决：默认 CUT，
除非发现已有真实消费者。

## 取证（删除前 grep）

| 面 | 外部消费者 | 结论 |
|---|---|---|
| `workbench.state` 集群（src/state.ts + client.ts 注册 + 测试） | 仅 `plugins/shared/contracts/workbench-contracts.ts` 的两处**文档注释**提及 id（:119、:464），无任何运行时导入；sidebar `client-types.ts` 无该 id 类型 | 零真实消费者 |
| composer/history 四件套（input-history / composer-input-history / composer-history-keyboard / composer-history-bridge） | 导入图封闭：仅互相引用 + 各自测试文件；`composer-input-history/-keyboard/-bridge` 外部导入为 **NONE** | 封闭簇 |

## 删除清单

- `plugins/workbench/src/state.ts`
- `plugins/workbench/src/client.ts` 中 state 的 import / 构造 / `provide('workbench.state')` 及头注（五服务→四服务）
- `tests/state-slice.test.ts`
- `tests/workbench-kernel.test.ts` 剪去三个 state 用例与 state 相关断言/源清单项（其余 14 用例保持不变并全绿）
- `plugins/sidebar/src/client/{input-history,composer-input-history,composer-history-keyboard,composer-history-bridge}.ts`
- 对应四个测试文件

## 恢复路径

全部内容在 git 历史（本次删除提交的父提交）可找回；如未来出现真实需求：
StateStore 语义按原实现重引即可，但必须先有具名消费方与持久化域设计
（persistVia 落 host 域），不得以"先放回去"方式复活。

## 已知残留（超出本叶 OWNS，移交驱动者）

`plugins/shared/contracts/workbench-contracts.ts:119/:464` 两处文档注释仍提及
`workbench.state`——纯注释、无类型/运行时影响，因契约文件不在本叶所有权内而未动；
建议驱动者在 node-structure 收口时顺手清理该注释块（或随下次契约文件变更顺带处理）。
