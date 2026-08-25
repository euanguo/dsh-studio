# Scope

These rules apply repository-wide. A nested `AGENTS.md` may narrow them for
its subtree. Keep this file to durable rules; put explanations in `docs/`.

# Architecture

- Desktop, Web, and TUI are surfaces over one pinned DSH runtime, not separate
  products or plugin systems.
- `src/profile.ts` owns surface composition. Keep the full/Desktop, Web-only,
  and TUI-only package boundaries intact.
- `src/data-root.ts` owns shared state under `~/.dsh-studio` (stable) and
  `~/.dsh-studio-dev` (dev). Use `DSH_STUDIO_HOME` for absolute overrides and
  `DSH_STUDIO_CHANNEL` to pick the sibling pair; do not invent another cache,
  credential, or configuration root.
- Load capabilities through the DSH Profile, Loader, and Cordis services. Do
  not add a second loader or bypass its permission boundary.
- Keep Files, PTY, Git, and Browser access scoped to the active Session and
  Workspace. Electron-only capabilities must remain Desktop-only.
- Treat `upstream/` as pinned source. Adapt upstream behavior in `plugins/`,
  retain attribution, and preserve the DSH Studio UI and contracts.
- Plugin chrome uses official `@deepseek-ai/dsh-client-ui-primitives`
  and `--dsw-*` tokens. See `plugins/AGENTS.md`. Do not add a second
  button, dialog, toast, or icon kit.
- `@dsh-studio/desktop-skins` owns shared theme identities across all surfaces
  (its durable preferences root comes from the `dshStudioSurface` contract, so
  one provider serves desktop and web). Surface adapters may change
  rendering, not theme ownership.
- Human and Agent marketplace actions use the same preview, approval, apply,
  and recovery transaction.
- Derive displayed versions from the repository version resolver. Do not
  duplicate versions, platform paths, executable names, or data roots.
- Make user-state migrations non-destructive, restart-safe, and idempotent.
- Client data flow: components render from zustand stores and `shared/runtime`
  caches; RPC caching uses the shared RevisionedStore layer exclusively;
  persistence goes through the shared `persistVia` facade onto host-owned
  domains (ui-chrome tables, settings namespaces, or nodeFs). No
  component-local loading/error/data fetch loops, no direct browser-storage
  writes. See `.workflow/specs/` and `scripts/guards/`.
- Preserve macOS arm64/x64, Linux x64, and Windows x64 behavior.

See `docs/design.en.md` and `docs/design.md` for detailed boundaries.

# Repository map

- `src/`: launchers, runtime supervision, profiles, and shared data.
- `plugins/`: built-in capability providers and surface adapters.
- `upstream/`: pinned third-party submodules.
- `scripts/`: build, staging, packaging, and smoke checks.
- `tests/`: reusable contract and regression tests.
- `docs/`: bilingual design and operating documentation.

# Change rules

- Inspect status, local instructions, consumers, and public contracts first.
- Prefer the smallest coherent diff. Preserve unrelated user changes.
- Use existing services and shared contracts before adding state or helpers.
- Invoke `$simplify` for behavior-preserving cleanup, deduplication, dead-code
  removal, or model reduction.
- Do not edit generated output in `dist/`, `.stage/`, `release/`, or caches.
- Do not weaken `.npmrc`, lockfile, provenance, or release safety policies.
- Update both language variants when user-facing documentation changes.
- Add tests only for reusable, non-trivial contracts or regressions.
- Run `pnpm run typecheck`, `pnpm test`, and `pnpm run build` when code changes.
  Run the relevant surface smoke or package check for runtime changes.

# Test rules

- Tests execute the code under test and assert on its behavior and output.
  Do not read repository sources only to grep them for strings, function
  names, CSS properties, or copy text: such assertions break on refactors
  while catching no regressions.
- Never replicate source constants inside a test to compare them back, and
  do not write existence-only checks (file exists, export is defined,
  `typeof === 'function'`) without exercising behavior.
- Config contracts are guarded structurally: parse the YAML/JSON, then
  assert on fields, not on raw line wording.
- Text-level guards are legitimate when they reconcile real artifacts:
  wire DTO keys vs host route tables, bundled-plugin inventories across
  patch/profile/inject lists, import-direction layering, and generated
  artifacts. State the guarded contract in a comment next to them.
- Desktop-skins selectors from `generated-selectors.ts` are version-pinned
  per upstream DSH revision. Tests pinning those hashes or stable semantic
  anchors (`[class*="_navCell"]`, slot selectors) are skin-port tripwires:
  they must fail loudly after an upstream bump so skins are consciously
  re-pinned via `pnpm run generate:selectors`. Do not delete them as
  brittle; re-anchor them during the port instead.
- Before removing a "brittle" test, classify it: behavioral, contract
  guard, or version tripwire. Only implementation-wording greps against
  files this repository owns are garbage.

# Commits and contributions

- Write commits, PR titles, PR bodies, and review replies in English.
- Keep each commit atomic and use `<module>: <subject>`.
- Include a body explaining why and impact. Keep every body line at most 72
  characters.
- Sign every commit the current PR introduces with the contributor's own DCO
  using `git commit -s`: `Signed-off-by: Name <email>`. Scope DCO checks
  only to those PR-introduced commits; never re-check commits already in
  the base history.
- An optional `Assisted-by: <tool>` trailer may disclose AI assistance. It is
  not a DCO, must not identify a fictional person, and is never required.
- Preserve upstream licenses, notices, links, and downstream attribution.
- In PRs, state scope and verification, link related issues, and resolve
  actionable review and CI failures before merge.

# Audit workflow

For every non-trivial task that writes to the workspace, choose a stable task
slug and keep agent-only records under:

```text
.agent-workflows/<agent-task>/
├── audit.md        # Baseline, decisions, evidence, verification, and gaps
├── commands.md     # Redacted commands, working directories, and results
├── scripts/        # Intermediate debug documents, scripts, and harnesses
├── output/         # Third-party dependencies and temporary binaries
└── logs/           # Decisive build, test, runtime, or diagnostic logs
```

Put every generated intermediate debugging document, debug script, and
scaffolding or harness script, including Bash and Python scripts, under
`scripts/`, never in a build directory. Put third-party source or libraries
acquired solely for the agent's task, and temporary binaries produced by
agent-only probes or tools, under `output/`. Do not copy normal project build
artifacts there. Keep other agent plans and temporary evidence in the same task
directory. In a Git worktree, add `.agent-workflows/` to the repository-local
exclude file returned by `git rev-parse --git-path info/exclude` before writing
audit artifacts. Preserve existing entries, avoid duplicates, and verify before
handoff that `git status --short` contains no `.agent-workflows/` paths. Keep
normal build trees, binaries, and test outputs separate: honor a user-specified
path, otherwise use `.stage/`, `dist/`, `release/`, `tmp/`, or the tool's
documented default. Record the effective paths, do not stage
`.agent-workflows/` unless requested, and report the task directory and
unresolved gaps at handoff.
