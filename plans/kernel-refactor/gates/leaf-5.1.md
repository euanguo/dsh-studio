# Gates: leaf-5.1 — i18n 类型纪律与重复键去重

OWNS: plugins/shared/terminal-messages.ts, plugins/shared/package.json, plugins/panel-controls/src/terminal/i18n.ts, plugins/sidebar/src/client/i18n.ts, plugins/desktop-left-rail/src/client/locales.ts, plugins/desktop-skins/src/client/i18n.ts, tests/i18n-discipline.test.ts

Scope: 引擎维持唯一（shared/i18n.ts），不建中央键表。terminal 表 5 个跨表重复键去重
（单源引用）；skins 接 LocaleMessages 类型；left-rail 键表双向 satisfies 收紧
（en 多余键报错）。类型纪律由全仓 typecheck 背书。

- [x] G1: 注册表重复键运行时断言——注册全部插件 locale 后，已知主题键交集为零（terminal 五键单源）
  CHECK: bash -lc 'node --test tests/i18n-discipline.test.ts && echo I18N-DISCIPLINE-OK'
  EXPECT: I18N-DISCIPLINE-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 114.833625 | I18N-DISCIPLINE-OK

- [x] G2: 类型收紧编译背书——全仓 typecheck 通过（LocaleMessages/satisfies 生效）
  CHECK: bash -lc 'pnpm run typecheck >/dev/null 2>&1 && echo I18N-TYPES-OK'
  EXPECT: I18N-TYPES-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=I18N-TYPES-OK

- [x] G3: 人工抽查——DEV 实机切 zh/en 各一轮：sidebar/left-rail/marketplace/终端面板无缺键回退（键名裸露）
  EVIDENCE: Clean DEV runtime verified Chinese↔English settings and shell chrome, left-rail tools, marketplace, and center terminal. Terminal remained mounted while the right sidebar was opened/resized and the marketplace overlay was opened; no raw locale keys or fallback labels were observed, and `errors`/`console` were empty. Evidence: `tmp/desktop-verify/w6/screenshots/04-en-terminal.png`, `08-zh-terminal-center.png`, `09-zh-terminal-locale.png`, `10-zh-home-terminal.png`, `14-zh-right-sidebar-drag-wide.png`, `16-zh-marketplace-sidebar-concurrent.png`.
