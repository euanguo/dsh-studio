# 右侧栏间距/布局实测问题清单（CDP 实测数据）

> 实测环境：Oh-DSH-Desktop dev 实例，CDP 连接，视口 1280x840（dpr=2），
> 面板宽度 480px（此前被拖宽并持久化），暗色皮肤。
> 所有数值来自 `getBoundingClientRect()` + `getComputedStyle()`。

## A. hover 背景 / 操作区贴边（视觉硬伤）

| # | 位置 | 实测 | 问题 |
|---|------|------|------|
| A1 | Git 文件行 `.oh-dsh-sc-row` | 行 x=827 w=423 到 1250，`padding-right:4px`；hover 背景铺满全宽 | hover 加深的背景左右几乎 0 间距贴合内容区边缘 |
| A2 | Git hover 操作按钮组 `.oh-dsh-sc-actions` | right=1248 vs 行 right=1250 → **距右缘仅 2px** | user 指出的"背景加深后没间距"就在这里 |
| A3 | Git trailing 状态区 | right=1248，距右缘 2px | 同上 |
| A4 | 文件浏览器行 `.oh-dsh-files-row` | x=789（content 左缘 = 面板内缘），`padding-right:8px` | hover 背景**左侧 0 间距贴面板边框** |
| A5 | 提交历史行 `.oh-dsh-review-commit-row` | pad `4px 12px`，hover 背景近全宽 | 与其它行体系不一致 |

## B. 三套列表左缘不齐（结构性）

| # | 列表 | 左缘 x | 与 content(789) 差 |
|---|------|--------|--------------------|
| B1 | 文件浏览器行 | 789 | 0 |
| B2 | Git 变更行（sc-list） | 827 | +38（`.oh-dsh-change-list` 残留 `padding-left:30px`） |
| B3 | 提交历史行（commit-list） | 827 | +38（`padding-left:30px`） |
| B4 | Git 区段标题（section-title） | 797 | +8 |

→ 三个列表三种左缘，视觉断裂；代码里 `.oh-dsh-change-list / .oh-dsh-review-commit-list / .oh-dsh-new-branch / .oh-dsh-commit-box` 均存在 30/40px 手写缩进。

## C. 字号碎片化（紧凑面板里混排小字号）

| # | 组件 | 实测字号 | 问题 |
|---|------|---------|------|
| C1 | 提交历史 hash / author | **9px** | 过小；subject 11px；行高却 32px |
| C2 | Git 行内 name / stat / mark | 11px / 10px / 10px | 三字号混排 |
| C3 | 工具栏计数徽章 | 10px（标题 11px） | 与标题不齐 |
| C4 | 菜单工具行 kbd | 11px，pill 高 17px，行高 40px | kbd 视觉偏小 |
| C5 | 目录路径小字 9px（directory 区块） | 9px | 过小 |

## D. 间距 token 未统一（硬编码 vs --oh-dsh-space-*）

| # | 位置 | 硬编码值 |
|---|------|---------|
| D1 | `.oh-dsh-change-list` | `padding: 0 2px 5px 30px`（30px 残留） |
| D2 | `.oh-dsh-review-commit-list` | `padding: 0 2px 8px 30px` |
| D3 | `.oh-dsh-new-branch` / `.oh-dsh-commit-box` | `padding-left: 40px` |
| D4 | 大量 7px/9px/18px padding、9px 字号 | 未走 4px 网格 / 字号阶梯 |
| D5 | section 高度不一致 | 28px 行 / 38px section 标题 / 58px 主 header |

## E. 面板壳 / 全局统一性

| # | 问题 |
|---|------|
| E1 | 面板 `.oh-dsh-side-panel` 把 `border-radius:22px + shadow` 压成 0/无，视觉贴死直角 |
| E2 | 面板宽度可拖到 480px（持久化），但行高/字号按窄栏设计，宽栏下留白感强 |
| E3 | 菜单态工具列表 `align-content:center` 垂直居中，上方留 ~300px 空白 |

## F. hover 可行域与可点击区

| # | 问题 |
|---|------|
| F1 | Git 文件行点击区是 `.oh-dsh-sc-main`（flex:1），状态/actions 区不响应点击，但视觉整行可点——hover 视觉与可点范围不一致 |
| F2 | 文件浏览器行同构（`.oh-dsh-files-row-main` flex:1），尺寸列不可点但 hover 全行高亮 |

---

## 修复原则

1. 全部间距走 `--oh-dsh-space-*` 4px 网格；字号走 `--oh-dsh-font-*` 阶梯（10/11/12/13px…），消灭 9px 系列。
2. hover 背景统一"内缩"：行 hover 背景不再填满 content 底，改为行内 inset（左右留 2-4px），操作按钮组与右缘留 4-6px。
3. 三套列表左缘对齐到同一条竖线（content padL 8px 起，或统一 12px）。
4. 保留组件逻辑与 DOM 结构，只动 CSS（client bundle 热更新，CDP 不断连）。