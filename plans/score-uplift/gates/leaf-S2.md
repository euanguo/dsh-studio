# Gates: leaf-S2 — fence 三原语行为测试

OWNS: tests/boundaries.test.ts

Scope: 为 isWithin（大小写分支、尾分隔符、前缀串陷阱、平台参数）、assertWithinSession、isTrustedApiRequest（DNS-rebinding host、Origin 不匹配、host 大小写）补行为测试；覆盖 process-tree-killer 的 PID 回收/root 信号语义。

- [x] G1: 边界行为套件全绿且四类靶点各有断言
  CHECK: bash -lc 'node --test tests/boundaries.test.ts && echo BOUNDARIES-OK'
  EXPECT: BOUNDARIES-OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/verger/.dsh-studio/worktrees/oh-dsh-desktop-rebase/ui-ux-refactor; path=e3c3b9a1781d/36 entries; output=ℹ duration_ms 81.035417 | BOUNDARIES-OK
- [x] G2: 分支覆盖清单人工核对（每类≥1断言）
  EVIDENCE: branch→assertion mapping — isWithin (8 tests): nested ok; base-equal; root edge `/`; sibling-prefix trap posix AND win32; trailing separator both separators; mixed `\` vs `/` normalization; case-insensitive ONLY with platform='win32' (posix default stays case-sensitive); targets above/beside refused. assertWithinSession (4): inside passes; cwd-itself passes; outside throws CapabilityError{code fs-error, status 403, message carries op}; sibling-prefix escape (/w1 vs /w1x) refused. isTrustedApiRequest (9): loopback quartet localhost/127.x/[::1] incl. port; missing Host refused; unparsable Host refused; public host + empty allowlist refused (DNS-rebinding contract); loopback lookalike octets (`127.0.0.256`, `127.1`) fail isLoopbackHostname; trusted exact host:port match and wrong-port mismatch; port-less entry matches any port of that host; host case-insensitivity; sec-fetch-site=cross-site refuses even loopback; Origin same/mismatched/malformed ternary. process-tree-killer (6, pure surface): children-map grouping with CRLF + whitespace-collapsed commands; malformed-row skip; command-map parse + junk skip; nested DFS depth-first order; pid-cycle survival via visited set + unknown-parent empty; terminateProcessTreeWithGrace invalid-pid guard falls back to pty.kill without touching the escalation slot. RESIDUAL GAP (explicit): the PID-recycle descendant re-check (`currentCommands.get(pid) === descendant.command` inside signalCaptured) and unconditional root signaling require real `ps` inspection plus `process.kill`, i.e. spawning/signaling live processes — not drivable from a unit suite per leaf constraints; covered indirectly at graph level by the cycle/ordering tests above, flagged for a future integration drill. Also recorded: raw `..` segments are not folded by isWithin — callers must resolve paths before guarding (upstream contract documented in the test-file header, not asserted as behavior).
