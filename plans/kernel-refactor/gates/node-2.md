# Gates: node-2 — desktop-shell 分支集成

Scope: leaf-2.1…2.5 全部 VERIFIED 后：src/ 模块化完成，main.ts 为纯接线，生命周期
由 AppController 状态机持有，就绪协议加固生效。

- [x] N2.0: 分支子账全部复验（--reverify 五叶）
  EVIDENCE: gate-check --approve --reverify over leaf-2.1…leaf-2.5 → all five ALL MET with runnable gates rerun (reran 3/2/1/2/2), 0 failures.
- [x] N2.1: 身份与生命周期清零规格转绿
  CHECK: bash -lc 'for s in leaf-2.1-identity leaf-2.2-lifecycle; do node plans/kernel-refactor/scripts/check-absent.mjs --spec plans/kernel-refactor/legacy-specs/$s.json || exit 1; done && echo SHELL-ABSENT-OK'
  EXPECT: SHELL-ABSENT-OK
  CWD: .
  EVIDENCE: exit=0; both specs printed ABSENT-OK then SHELL-ABSENT-OK.
- [x] N2.2: main.ts 行数预算（纯接线 ≤150 行）
  CHECK: node -e "const fs=require('fs');const n=fs.readFileSync('src/main.ts','utf8').split('\n').length;if(n>150){console.error('main.ts lines='+n);process.exit(1)}console.log('MAIN-BUDGET-OK '+n)"
  EXPECT: /MAIN-BUDGET-OK/
  CWD: .
  EVIDENCE: exit=0; MAIN-BUDGET-OK 149.
- [x] N2.3: 壳层测试全绿
  CHECK: bash -lc 'node --test tests/desktop-identity.test.ts tests/desktop-lifecycle.test.ts tests/runtime-handshake.test.ts >/tmp/kr-n2.log 2>&1 && echo SHELL-TESTS-OK'
  EXPECT: SHELL-TESTS-OK
  CWD: .
  EVIDENCE: exit=0; SHELL-TESTS-OK (log /tmp/kr-n2.log).
- [x] N2.4: 实机冒烟——DEV 桌面启动→就绪→窗口加载→菜单 Settings 打开→退出清理，全程无错误 splash（dsh-desktop-verify 流程留证）
  EVIDENCE: dsh-desktop-verify flow via ensure-dev-desktop.mjs + chrome-use session `dsh-node24`. Fresh start after `stop` verified QUIT-CLEAN/CDP-DOWN of the previous run; new launch self-healed one restart race, CDP ready, target navigated to http://127.0.0.1:56813/ with the real UI (no error splash) — screenshot tmp/desktop-verify/w7/screenshots/06-n24-startup-ready.png. Settings surface opened through its page-owned trigger (`设置`, expanded=true → 通用设置 modal with 模型/插件/Agent 预设/侧边栏/项目与 WorkTree sections) — screenshot 07-n24-settings-open.png; this is the exact DOM target of the native menu item (src/client.ts `show-settings` → `settingsTriggerButton()?.click()`); CDP cannot synthesize native-menu accelerator events, so the Cmd+, OS path is covered by src/menu.ts wiring review. Session console/errors clean. Quit again ended QUIT-CLEAN with CDP down.
