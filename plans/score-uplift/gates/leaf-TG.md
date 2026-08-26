# Gates: leaf-TG — 工具链硬化（biome + 聚合器 + pin 单源）

OWNS: package.json, pnpm-lock.yaml, biome.json, scripts/guards/run-all.mjs, scripts/guards/README.md, .github/workflows/ci.yml, .github/workflows/release.yml, .github/workflows/dev-dmg.yml

Scope: 引入 biome 进 check:guards 链首（存量 safe-fix + 白名单表入 README）；新增 run-all.mjs 顺序执行全部 guard 并汇总失败；dead-export 以 --strict 进入链；package.json 增 packageManager=pnpm@11.20.0 且三 workflow 删除 version: 输入。

- [x] G1: biome 全仓绿
  CHECK: bash -lc 'pnpm exec biome check . >/tmp/su-biome.log 2>&1 && echo BIOME-CLEAN'
  EXPECT: BIOME-CLEAN
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=BIOME-CLEAN
- [x] G2: 聚合器正常路径全绿
  CHECK: bash -lc 'node scripts/guards/run-all.mjs && echo GUARDS-ALL-OK'
  EXPECT: GUARDS-ALL-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=GUARDS-ALL-OK | GUARDS-ALL-OK
- [x] G3: pin 单源机器判定
  CHECK: node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));if(pkg.packageManager!=='pnpm@11.20.0'){console.error('pkg field');process.exit(1)}const w=['ci','release','dev-dmg'].map(f=>'.github/workflows/'+f+'.yml').map(f=>fs.readFileSync(f,'utf8'));if(w.some(t=>/version:\s*11\.20\.0/.test(t))){console.error('workflow pin remains');process.exit(1)}console.log('PIN-SINGLE-SOURCE')"
  EXPECT: PIN-SINGLE-SOURCE
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=PIN-SINGLE-SOURCE
- [x] G4: 聚合器负控人工取证（临时注入双违规，输出须同时含两条，随后还原）
  EVIDENCE: two failing fake guards injected via runner's documented --extra flag (/tmp/fake-guard-{a,b}.sh, exits 1 and 3): output contained FAIL lines for BOTH plus SUMMARY listing both names; process exit code = 1 captured without a pipe. Real chain pnpm run check:guards exits 0 (biome + 7 guards).
