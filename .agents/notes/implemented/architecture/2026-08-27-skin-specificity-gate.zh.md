# Agent Note: Skin geometry wins by stacked-specificity gate, not !important

Status: implemented

## Problem

ChatGPT 皮肤样式表需要重塑上游 DSH 组件，而后者的 CSS 与皮肤同时加载。历史上
每条皮肤几何规则都带 `!important`——最初是笼统习惯，后来被降级实测"证明"上游
不 force 会赢。强制声明累积到 82 处；用户要求治理时有两个事实使盲删不安全：
仓库内共享 CSS 确实以自己的 force 拥有部分状态悬浮色，而部分皮肤 selector 是
已不再命中任何元素的版本钉死上游修复。

级联等价测量还有一个陷阱：在 CSSOM 里降级 `var()`-pending shorthand
（`padding: var(--x) !important`）会删除整条声明而不是降低优先级，因此早期
降级运行对每条 token 驱动的规则都给出了"上游会赢"的假结论。

## Decision

`skins.ts` 通过 `SKIN_GATE` 门控每条组件几何 selector，把
`data-dsh-studio-skin` 属性**堆叠四次**：

```css
body[data-dsh-studio-skin][data-dsh-studio-skin][data-dsh-studio-skin][data-dsh-studio-skin] .upstreamHash { … }
```

CSS 规范规定重复书写属性选择器会逐个累计特异性：class 规则达 (0,5,1)，
`:has()` 的 settings-trigger 例外达 (0,7,1)。实测最高的竞争上游规则是官方
菜单行 `body > div[role=menu] [role=menuitem]:not(..):not(..)`，为 (0,4,2)——
三次堆叠 (0,4,1) 会在 element 数 tiebreak 上落败，四次稳压且有余量。逐类
挂门控必须保留（不带门的精确哈希退化为 (0,1,0)，会输给皮肤自己的通用
button/menu 规则）。

基于以上证据，29 条强制声明降为普通级联：菜单项几何、menuitem 角色尺寸、
item wrap/label 重置、导航 cell、settings-trigger 例外、dialog shell
边框/阴影、Button-md 规格、过滤 pill。force 仅保留在无在线验证的场景
（重命名输入、selector 控件、为上游修复钉死的 trigger pill 哈希、primary
pill、focus-within 修复、toast、onboarding 遮罩）——force 是最后手段，
不是默认。

## Alternatives considered

- **Body ID 选择器（`#dsh-studio-skin-host …`）**——(1,0,0) 压过任意 class
  链，但要在宿主 `<body>` 上添加全局命名空间 ID，是在既有属性之外新增的
  第二个宿主 DOM 契约，而实测冲突根本不需要这种强度。输给属性堆叠。
- **保留全部 `!important`**——鲁棒性最高，但这正是治理要移除的东西；它还会
  压制仓库内以 force 实现的合法状态覆盖。落败：实测冲突全部是非 force 的
  级联竞争。
- **重排/末位追加皮肤 `<style>`**——对宿主动态注入顺序脆弱，且不提供
  特异性余量。落败。
- **补丁上游使其消费皮肤 token**——长期最干净的方案，但 `upstream/` 是
  pinned 源，token 源头所有权属于上游范畴。延后；gate 是仓库内的适配点。

## Consequences

皮肤几何改由特异性取胜，样式表回归正常级联读法，插件特性 CSS 无需 force
即可覆盖。漂移安全从 importance 转移到 gate 常量：上游升级越过 (0,5,1) 或
新增 `!important` 会静默落败——tripwire 测试钉住四重堆叠契约及 navCell /
settings.trigger 的 force-free 块使失败大声化，`pnpm run generate:selectors`
仍是 re-pin 点。保留的 29 条 force 在
`.agent-workflows/marketplace-geometry-audit/audit.md` 逐一列明；每条都需要
各自的在线状态测量后才能降级。级联等价审计必须通过 shorthand 槽位解析
`var()`-pending 声明（修复后的审计器在
`.agent-workflows/marketplace-geometry-audit/scripts/audit-cascade-winner.js`）。
