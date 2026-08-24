# Workbench Interaction Model and State Scoping

> Status: proposal · 2026-08-23
> Research basis: Minke v0.2.0 architecture comparison, Exa web research
> (2025-05 ~ 2026-08, ~30 queries, 280+ results, 22 full-text reads, including
> first-party issues from VS Code / Claude Code / Codex / Cursor / Zed).
> Evidence: `.agent-workflows/research-minke-vs-dsh-studio/` (repo-local excluded).

[简体中文](./interaction-model.md) · English

---

## 0. Problem

The DSH Studio desktop workbench is three self-built columns: the left rail
Project→Worktree→Session tree (`desktop-left-rail`), the right tool panel
(`sidebar` / `SideToolsPanel`), and the center conversation +
`center-surface-host` multi-surface tab strip. This design answers four
questions:

1. Where should tool content be consumed — inside the right panel (the Minke
   model) or in the center area (current model)?
2. What are the open-behavior boundaries — single/double click, preview vs
   pinned open, focus stealing?
3. Who owns panel/tab/tool state — the session, the project (worktree/cwd),
   or the app?
4. Who owns selection comments (review comments) — the code location they are
   anchored to, or the session that produced them?

## 1. Decisions at a glance

| # | Decision | Direction |
| --- | --- | --- |
| D1 | Content consumption | **Keep "right panel launches, center center-surface consumes"**; do not adopt Minke's self-contained right panel |
| D2 | In-chat file links | Add a "quick preview in right panel" short path; **background open, never steal focus** |
| D3 | Agent auto-open | Agent file writes must **not** auto-open/jump; expose clickable chips instead |
| D4 | Preview tabs | Keep click-to-preview / double-click-to-pin, **add a preference toggle** |
| D5 | State scoping | Default **per-worktree(cwd)**; add a global-layout preference; **selection comments attach to worktree+branch and are shared across sessions** |
| D6 | Side chat | Explicit "temporary question" semantics (Codex `/side`); never pollutes the main thread |
| D7 | Right-panel geometry | Keep drag-resize/maximize/side-switching; width remembered per worktree |

## 2. Rationale

### D1 Launch from the right, consume in the center

- anthropics/claude-code#62829 (bug): with Claude Code docked in the secondary
  sidebar, file links opened "as a tab in the same panel/sidebar as the chat…
  Chat window becomes narrow, file preview is very small". Users require files
  to open in the **main editor area**.
- Cursor forum threads ("Chat is fixed-width even with a large screen", …):
  reading code in a narrow rail is a widespread pain point.
- "The Sidebar is Dead, Long Live the Duet" (Medium, 2026-03): pure sidebars
  trap users in Human-in-the-Loop micro-confirmations.
- Converging best practice: *"a side panel for quick guidance and a focused
  work mode for complex tasks"*.

Minke's self-contained right panel works for one tool at a time; multi-file
comparison, long diffs, and parallel terminals need the main canvas. Claude
Code users already filed bugs against content trapped in a sidebar.

### D2/D3 Open behavior: preview short path, no auto-jump

- microsoft/vscode#298700 (filed by VS Code team member egamma, fixed in
  1.115): agent-opened files "fill the editor with many opened tabs"; expected:
  don't auto-open — inspect via chat links on demand.
- openai/codex#13718, zed commit 62b9a98, opencode #12608/#18836: products are
  converging on clickable file references that navigate correctly — the
  landing target of a file reference is core interaction, not an accessory.
- Cursor forum bug (2026-08) "Agent Window steals focus and opens file tabs":
  focus stealing during agent runs is treated as a serious defect.

Rules:

1. **Focus invariant**: no renderer-initiated open may move keyboard focus or
   scroll position; interrupting the composer counts as a regression.
2. In-conversation file references open as a **right-panel quick preview**
   first; explicit user action (double-click / "open in center" menu / pin)
   promotes it to a center surface tab.
3. After agent edits, do not auto-open; render file chips in the conversation
   card that follow rule 2.

### D4 Preview-tab semantics and preference

Long-running community debate (vscode#81093/#9388/#128755; zed#39054/#4324/
#53203; Cursor forum "double-click file reference should open full tab")
converges on:

- single click = preview (italic tab, at most one, replaces the previous
  unpinned preview); double click/pin = permanent tab;
- a preference is required: `workbench.previewTabs: 'default' | 'disabled'`
  (disabled = single click opens permanently);
- dirty buffers are never discarded by preview replacement (already true).

### D5 State scoping: per-worktree by default, optional global; comments belong to code

Two mainstream implementations coexist:

- **per-workspace**: Zed default; Discussion #55054 reports layout snapping on
  project switch and requests a global option now that agentic panels make
  switching frequent;
- **per-session**: VS Code Agents window (`src/vs/sessions/LAYOUT_CONTROLLER.md`)
  keeps per-session panel/editor working sets.

DSH Studio stance: **the worktree is the user's mental working environment**
(per-worktree tooling ecosystem; parallel agents × git worktrees). Therefore:

1. Right-panel tab layout, center tab queue, explorer/Git runtime caches, and
   project-shared PTYs (`${cwd}:${tabId}`) stay per-worktree(cwd);
   localStorage bucketing restores state on switch-back.
2. New preference `layoutScope: 'workspace' | 'global'` (default workspace):
   global shares one right-panel layout and center queue across worktrees.
3. **Selection comments re-scoped**: their natural anchor is a code location
   (GitHub review comment = `path + line(side) + commit_id`, outdated markers;
   GitLab discussions likewise; Gerrit re-anchors ranges across patchsets).
   The current `scopeOf() = sessionId\0cwd\0branch` splits annotations of the
   same code across conversations. Fix:
   - bucket key `workspacePath\0branch` (matches seededScopes; sessionId removed);
   - add `authorSessionId?` as author metadata only; optional resolved/outdated
     markers with explicit labeling (GitLab #588416 lesson: never silently
     relocate anchors; crit#296 content-based anchoring as future work);
   - migrate v1 storage once, merging into new buckets idempotently.
4. Side chat / trajectory remain session actions.

### D6 Side chat = temporary questions

Codex `/side`: side window for throwaway questions, main thread unaffected.
Keep our fork-based side chat; sharpen copy and keep ad-hoc sessions out of
the main list ordering.

### D7 Right-panel geometry

Cursor forum feedback proves narrow-rail reading pain; keep resize/maximize/
side-switch, remember width+maximized per worktree, global default width only.

## 3. Implementation breakdown

| Item | Surface | Size |
| --- | --- | --- |
| D2 link→panel preview | `plugins/sidebar/src/client/intercept.ts`, `SideToolsPanel.tsx` | M |
| D3 no auto-open | audit `openPreviewableSurface` callers; file chips in cards | M |
| D4 preview preference | `sidebar-preferences.ts`, `center-surface-store.ts` | S |
| D5a layoutScope pref | `sidebar-preferences.ts`, `center-surface-store.ts` read layer | M |
| D5b comment re-scope | `review-comments.ts`: drop sessionId from scopeOf, storage migration, author metadata, outdated marker | M |
| D6 side-chat copy/order | `builtins/tabs.tsx`, left-rail ordering | S |
| D7 geometry per worktree | `sidebar-preferences.ts` | S |

Acceptance highlights:

- focus-invariant automated check around file opens;
- worktree switch round-trip restores queues/layout/PTY (extend smoke);
- a comment added in session A is visible and resolvable in session B on the
  same diff line;
- `previewTabs: disabled` makes single click create a pinned tab;
- storage migration is idempotent.

## 4. Non-goals (this round)

- Infinite-canvas spatial layouts (Collaborator-style).
- Restoring the cut bottom workbench mount.
- Command palette (separate proposal).

## 5. References

See the Chinese edition for the full annotated list; evidence archives live in
`.agent-workflows/research-minke-vs-dsh-studio/`.
