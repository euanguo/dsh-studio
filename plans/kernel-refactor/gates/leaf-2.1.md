# Gates: leaf-2.1 — 桌面身份单一源 + 品牌 hack 链删除

OWNS: src/desktop-identity.ts, src/desktop-chrome.*, src/main.ts, src/update-manager.ts, src/client.ts, plugins/sidebar/src/client/surfaces/dsh-dom.ts, tests/desktop-identity.test.ts

Scope: 新建 desktop-identity 模块收编 PRODUCT_NAME/appId/repo/title 派生与
assertReleaseIdentity；update-manager 与 main 改为消费该模块；删除 installHeroBranding
MutationObserver 整链与 document.title hack（标题经 bridge getInfo 单源）；
findSettingsButton 探测移出 src/client.ts（迁 sidebar dsh-dom.ts 或改官方 API——裁决见 G4）。
抽取 `DESKTOP_CHROME_CSS` 时必须保留 `5928e82` 的 brand-row 隐藏 selector、
collapsed rail traffic-light clearance，以及 `ed194ce` 的 toggle label 语义。

- [x] G1: 身份模块行为测试——appId dev 后缀、标题 Dev/stable 变体、repo 解析、断言失败路径
  CHECK: bash -lc 'node --test tests/desktop-identity.test.ts && echo IDENTITY-TESTS-OK'
  EXPECT: IDENTITY-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 160.657208 | IDENTITY-TESTS-OK
    （dev 变体=stable 派生、repo owner/repo 形状、officialReleaseUrl 经同一 repo 事实、
    releaseIdentityProblem 三条漂移分支+一致路径全绿）。

- [x] G2: 清零规格转绿——src 内 repo 字面量/品牌 observer/settings 探测残留为零
  CHECK: node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/leaf-2.1-identity.json
  EXPECT: ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ABSENT-OK
    findSettingsButton 在 src/main.ts / src/update-manager.ts / src/client.ts 均零命中）。

- [x] G3: 现有更新链路测试不回归
  CHECK: bash -lc 'node --test tests/update-manager.test.ts && echo UPDATE-REGRESS-OK'
  EXPECT: UPDATE-REGRESS-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 107.978125 | UPDATE-REGRESS-OK
    改消费 desktop-identity 的 officialReleaseBase 后原套件全通过）。

- [x] G4: 两项产品裁决记录——(a) hero 文案链删除的上游文案归属确认；(b) settings 打开路径的最终实现（官方 API 或 dsh-dom 探针）及理由；写入本账并同步 plugins/AGENTS.md 若新增探针
  EVIDENCE: met（人工门，leaf-2.1 记录如下，待驱动者复核）
    (a) installHeroBranding MutationObserver 整链删除：会话页 hero 文案归上游 DSH 所有
        （PLAN Q3 裁决），桌面壳不再改写任何上游文本；实例标题单源为
        windowTitleForChannel（main 进程 BrowserWindow title），渲染层 document.title hack
        一并删除，不再有第二标题通道。
    (b) settings 打开路径裁决为 dsh-dom 探针：核查现实后确认钉版 DSH 客户端无官方程序化
        "打开设置" API（无 service/slot；marketplace 插件同样在自己的探针模块点 trigger）。
        findSettingsButton 三级探测语义原样迁入 plugins/sidebar/src/client/surfaces/dsh-dom.ts
        的 settingsTriggerButton()（唯一合法探针模块，耦合注释随迁）；src/client.ts 经相对
        源码路径导入（先例：main.ts 导入 plugin-marketplace host 源码）。未新增探针语义，
        plugins/AGENTS.md 无需改动。
    附注：DESKTOP_CHROME_CSS 已按修订后 OWNS（src/desktop-chrome.*）抽出为
        src/desktop-chrome.ts（CSS 块与抽取前逐字节一致，脚本比对 CSS-IDENTICAL）；
        brand-row 隐藏 selector、collapsed rail `--dsh-studio-traffic-top` clearance、
        dsh-dom toggle label 语义逐字保留。guard-no-inline-probe 复跑 GUARD-OK。
