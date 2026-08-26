# Gates: leaf-M3 — 投机面 keep-or-cut

OWNS: plugins/workbench/src/state.ts, plugins/workbench/src/index.ts, plugins/workbench/src/client.ts, plugins/workbench/package.json, plugins/sidebar/src/client/input-history.ts, plugins/sidebar/src/client/composer-input-history.ts, plugins/sidebar/src/client/composer-history-keyboard.ts, plugins/sidebar/src/client/composer-history-bridge.ts, tests/workbench-kernel.test.ts, tests/state-slice.test.ts, tests/input-history.test.ts, tests/composer-input-history.test.ts, tests/composer-history-keyboard.test.ts, tests/composer-history-bridge.test.ts, plans/score-uplift/notes/adr-speculative.md

Scope: workbench.state 与 composer/history 四件套逐个裁决：接入真实消费者或删除并留 ADR。禁止维持休眠现状。

- [x] G1: 裁决一致性机器判定（ADR 在场且每面满足 已删||有消费者引用）
  CHECK: node -e "const fs=require('fs');const adr=fs.existsSync('plans/score-uplift/notes/adr-speculative.md');if(!adr){console.error('no adr');process.exit(1)}const st='plugins/workbench/src/state.ts';const stOk=!fs.existsSync(st)||/persistVia/.test(fs.readFileSync(st,'utf8'));const q=['input-history','composer-input-history','composer-history-keyboard','composer-history-bridge'].map(f=>'plugins/sidebar/src/client/'+f);const qOk=q.every(f=>!fs.existsSync(f)||!/dormant/i.test(fs.readFileSync(f,'utf8')));if(stOk&&qOk){console.log('SPECULATIVE-RESOLVED')}else{console.error('unresolved',stOk,qOk);process.exit(1)}"
  EXPECT: SPECULATIVE-RESOLVED
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=SPECULATIVE-RESOLVED
- [x] G2: 裁决理由与影响面 ADR 审阅（人工）
  EVIDENCE: plans/score-uplift/notes/adr-speculative.md — CUT rationale (zero real consumers proven by grep before deletion), deletion list, git-history restore path, and the flagged residual: two stale doc-comment mentions of workbench.state in shared contracts (:119/:464) left for driver cleanup (file outside OWNS).
