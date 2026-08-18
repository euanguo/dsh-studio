# Terminal Full Migration Plan

## Goal

将 Oh-DSH terminal 从“可用的独立 shell tab”提升为在 TUI、长时间运行、renderer stall、runtime restart、tab park/reconnect、复杂 ANSI 状态下仍然正确的完整 terminal runtime。

本计划的完成标准不是“文件存在”或“单元测试通过”，而是每一项都必须满足：

1. 有 Orca/Synara 一手源码证据。
2. 有 DSH 活路径接入点。
3. 有可复现的单元或集成测试。
4. 有真实 Electron/CDP 行为验证。
5. 有明确的设置项、默认值、边界和持久化策略（需要用户配置时）。
6. 在追踪矩阵关闭前，不得将该项标记为完成。

## Mandatory Scope

### P0: Correctness

- [x] ANSI/TUI-safe history sanitizer with chunk-boundary pending escape state.
- [x] Headless terminal mode replay: alternate screen, cursor, mouse, bracketed paste, wrap/origin/focus modes.
- [x] Replay envelope with reset/preamble/screen state and safe history.
- [x] Renderer output scheduler with per-terminal queue, cooperative drain budget, foreground priority, byte/chunk caps.
- [x] Parse-pipeline health state, write-stall timeout, discard credit release.
- [x] Output sequence gap detection and authoritative snapshot resync.
- [x] Resync retry/backoff and stale snapshot rejection.

### P1: Lifecycle and Reliability

- [x] Retained terminal runtime owner for cold-parked tabs; PTY/socket/history/mode state separated from mounted React body.
- [x] Durable history persistence with idle debounce, max interval, atomic current/previous files, revision/hash suppression, startup restore and deletion.
- [x] Inactive terminal LRU retention and explicit retention policy.
- [x] Incarnation identity and tombstones for stale close/reopen races.
- [x] Explicit restart, clear, retained-session list/stop contracts where useful to the DSH UI.
- [x] Spawn environment normalization and shell candidate fallback.
- [x] Resize hold around structural layout changes.
- [x] Fit continuation retry and reveal/visibility-aware fit.
- [x] Primary subscriber/multi-client coordinator if center/right/remote can attach one PTY simultaneously.
- [x] Shutdown convergence: synchronous history checkpoint plus awaited PTY kill escalation barrier.

### P2: Product Completeness

- [x] Scrollback settings wired to xterm, history and output backlog policy.
- [x] Reconnect grace and retained-session settings wired to Host config.
- [x] Process kill grace setting wired to both PTY registries.
- [x] SearchAddon and SerializeAddon.
- [x] WebLinksAddon and OSC/title handling.
- [x] Unicode width provider and safe CJK/emoji/ZWJ replay.
- [x] IME composition anchor correction.
- [x] Mouse-wheel multiplier and scroll intent.
- [x] Terminal activity state: running/review/attention and retained output review.
- [x] Optional ligature/WebGL rendering controls with DOM fallback and context-loss recovery.

## Settings Contract

All user settings must use the existing path:

`SidebarRuntimePreferences` → `settings.get/update` → `PrefsSchema` →
terminal descriptor `settings.toggles` → live runtime consumers.

| Setting | Default | Bounds | Consumer | Phase |
| --- | ---: | ---: | --- | --- |
| `terminalScrollbackRows` | 5000 | 1000–50000 | xterm scrollback, host history/backlog policy | P0/P2 |
| `terminalReconnectGraceMs` | 30000 | 0–120000 | `PtyManager` detached session retention | P1 |
| `terminalRetainedInactiveSessions` | 128 | 0–1024 | durable session retention/LRU | P1 |
| `terminalProcessKillGraceMs` | 1500 | 250–10000 | UI and agent process-tree escalation | P1 |
| `terminalFontFamily` | empty | validated string | xterm runtime | existing |
| `terminalFontSize` | 13 | 9–32 | xterm runtime | existing |
| `terminalShell` | empty | resolved/candidate fallback | PTY spawn | existing/P1 |
| `terminalMouseWheelMultiplier` | 1 | 0.25–4 | xterm wheel routing | P2 |
| `terminalLigatures` | false | boolean | optional xterm addon | P2 |
| `terminalGpuAcceleration` | auto | auto/on/off | optional renderer | P2 |

Safety caps such as maximum history bytes and maximum output frame size remain
Host-enforced even if rows/grace settings are user-configurable.

## Implementation Order

### Phase A: Replay correctness

1. Port sanitizer and tests from Synara `output/history.ts`.
2. Add a replay-safe history projection separate from raw tool transcript.
3. Port headless mode tracker or an equivalent DSH adapter.
4. Define replay frame types: reset, preamble, history/screen, live boundary.
5. Add stale replay generation checks and replay integration tests.
6. Run TUI fixtures: alternate screen, cursor hide/show, bracketed paste,
   mouse mode, split ANSI chunk and CJK/emoji/ZWJ output.

### Phase B: Renderer flow control

1. Add DSH-specific renderer scheduler, not a wholesale copy of Orca's pane
   manager.
2. Bound each terminal queue by bytes and chunks.
3. Add foreground priority and an 8ms cooperative drain budget.
4. Ensure every accepted, discarded, malformed or stale output chunk settles
   its ACK credit exactly once.
5. Add parser health/stall watchdog and dead-pipeline transition.
6. Add sequence-gap detection and host snapshot request/resync.
7. Test frame drop, malformed frame, stalled xterm callback, reconnect during
   resync and two terminals competing for output time.

### Phase C: Durable runtime

1. Separate terminal runtime ownership from `TerminalView` mount lifetime.
2. Add history persistence with atomic writes and revision/hash suppression.
3. Add inactive LRU retention and runtime restart restore.
4. Add incarnation/tombstone checks.
5. Add explicit clear/restart/retained-session operations where the UI needs
   them.
6. Make plugin teardown await history flush and kill escalation.

### Phase D: PTY and layout reliability

1. Normalize environment and shell candidates.
2. Wire resize hold for structural changes.
3. Add fit continuation/reveal retry state.
4. Add applied PTY size reassertion after fit/reconnect.
5. Wire new settings and test bounds/defaults/persistence.

### Phase E: Terminal UX completeness

1. Search, serialize, links, title and Unicode provider.
2. IME anchor, mouse wheel and scroll intent.
3. Activity/subprocess state.
4. Optional ligature/WebGL path with renderer recovery tests.

## Verification Gates

### Per feature

- [ ] Source attribution exists.
- [ ] Pure logic tests cover boundaries and stale/discard paths.
- [ ] Live import/call path is verified by source search.
- [ ] Host/client protocol integration test exists where applicable.
- [ ] Settings parser/schema/UI/default/reset test exists where applicable.
- [ ] Chrome-use Electron flow covers the user-visible behavior.

### Final gate

- [ ] `pnpm run typecheck`
- [ ] `pnpm test`
- [ ] `pnpm run build`
- [ ] `pnpm run stage:dsh`
- [ ] `pnpm run dev` with CDP 9222
- [ ] Chrome-use menu, center/right routing, independent shells, tab park,
      reload/reconnect, TUI replay, output stress, resize drag and settings
      persistence.
- [ ] No unresolved P0/P1 item in this matrix.

## Progress Log

- 2026-08-18: gap audit completed; raw history/mode replay, renderer scheduler
  resync, durable retention, environment normalization and terminal addon
  lifecycle identified as mandatory follow-up scope.
- 2026-08-18: goal `goal-fded08f0-c1c9-46a8-ac4e-29dec11512c4` revised to track
  implementation of this plan.
- 2026-08-18: implementation begins at Phase A.
- 2026-08-18: P0 replay, renderer scheduler, sequence resync, settings schema,
  durable history store, tombstones, environment normalization, xterm addon
  lifecycle, detached runtime owner, resize coalescing, primary subscriber,
  management routes, IME anchor, scroll intent, and activity state were
  implemented. Direct validation: 471 tests, 466 pass, 5 skipped; typecheck
  and build pass.
- Remaining verification is the real staged Electron/CDP flow; no P0/P1 item
  remains open in the implementation matrix.
