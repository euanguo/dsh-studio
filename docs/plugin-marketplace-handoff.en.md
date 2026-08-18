<p align="center">
  <a href="./plugin-marketplace-handoff.md">简体中文</a> ·
  <strong>English</strong>
</p>

# Oh-DSH Marketplace Refactoring Handoff

## Current implementation

The marketplace Host now owns a single source seam:

- `source-types.ts` defines `SourceRef`, catalog records, candidate evidence,
  and source-lock facts;
- `source-resolver.ts` canonicalizes repository input and exposes
  `resolveCatalogSource`, `resolveRepository`, and `makePlan`;
- `github-source-adapter.ts` reads public GitHub refs and exact-commit files
  over HTTPS, with the existing authenticated fallback in the platform;
- `candidate-validator.ts` validates package metadata, patch syntax, entries,
  peer compatibility, lifecycle scripts, and hashes;
- `catalog-source-manager.ts` computes snapshot digests and priority-based
  merge/dedupe;
- `source-lock.ts` migrates legacy state and persists v3 provenance.

`PluginMarketplaceManager` remains the only preview/apply/rollback/Undo owner.
Catalog and direct repository inputs enter the same candidate and plan path.

## Runtime rule

The pinned DSH source proves that `dsh plugin` forwards to pnpm and reconciles
only dependencies declaring `dsh.bundle`. Profile loading resolves the package
names in `dsh.profile.bundles` and their declared patch files. The removed
repository-plugin path is not consumed by the Loader.

A repository containing only `.dsh-plugin/package.json` therefore receives a
`guide-only`/`blocked` candidate and cannot enter preview or apply. No
`repository-plugins` patch or repository cache is written by the current
marketplace implementation.

## Mandatory static fixture

Use the exact source and commit below in source-level or isolated fixture tests:

`https://github.com/JUSTMONIKA2022/dsh-sandbox-escalation-fix`

`19f2cb4cecc178313d2f54458badfc1bcb8bc816`

Expected facts are package `dsh-sandbox-escalation-fix`, bundle mechanism,
installable execution, `package.json`, `cordis.patch.yml`, exact commit, and a
`prepare` script that requires confirmation. The fixture tests do not clone,
install, build, load, or execute the repository.

## Verification discipline

Use Fake Repository Adapters, Fake Platforms, temporary Profiles, static DSH
source assertions, typecheck, lint, and isolated unit/contract tests. Do not
start DSH, Electron, Web, TUI, a browser, a marketplace runtime, or a
replacement server. Do not run third-party lifecycle scripts or modify a real
`OH_DSH_HOME`.

The local research clones referenced by the original handoff are absent in this
checkout. The implementation audit records that fact and records the official
pinned DSH source files that were actually read.
