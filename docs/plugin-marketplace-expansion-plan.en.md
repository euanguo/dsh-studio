<p align="center">
  <a href="./plugin-marketplace-expansion-plan.md">简体中文</a> ·
  <strong>English</strong>
</p>

# Oh-DSH Marketplace Expansion Plan

## P0 contract

Oh-DSH accepts a catalog entry or a public GitHub `owner/repo` or HTTPS URL
without requiring catalog membership. A single Host source resolver produces a
`MarketplaceCandidate` and `MarketplacePlan` for both paths.

The resolver must:

- canonicalize the GitHub source and retain the requested ref;
- resolve and use a lowercase 40-character commit for every read and execution
  path;
- read and validate the exact commit's `package.json`,
  `dsh.bundle.patch`, patch file, main/exports/client entry files, package
  name/version/license, DSH peer compatibility, and lifecycle scripts;
- calculate manifest, patch, and artifact hashes;
- emit an allowlisted `github:owner/repo#<sha>` install spec;
- record catalog origin, requested ref, install spec, exact commit,
  manifest path, and hashes in the source lock.

The pinned DSH runtime consumes only a dependency that declares
`package.json#dsh.bundle.patch` and the profile's ordered
`dsh.profile.bundles` list. `.dsh-plugin`, `repository-plugins`, and
`config.repositories` are diagnostic-only and cannot create an apply-capable
plan.

## Transaction and approval

All installable candidates continue through the existing transaction owner:

`candidate -> plan -> approval -> isolated preview -> atomic apply -> undo`.

Materialization uses `--ignore-scripts`. Lifecycle scripts are displayed in the
plan and run only after explicit, one-time confirmation inside the existing
write-restricted preview adapter. Preview and discard must not change the live
Profile. Apply failure restores the old Profile, and Undo restores the Profile
that existed before the successful apply.

The UI and Agent submit the same `SourceRef`, consume the same candidate and
plan, and use the same Host-generated risk and approval decision. Approval is
not persisted as a permanent allowlist.

## Mandatory fixture

The source-level and isolated fixture contract is:

- URL: `https://github.com/JUSTMONIKA2022/dsh-sandbox-escalation-fix`
- resolved commit: `19f2cb4cecc178313d2f54458badfc1bcb8bc816`
- package: `dsh-sandbox-escalation-fix`
- mechanism: `bundle`
- execution: `installable`
- manifest: `package.json`
- patch: `cordis.patch.yml`
- lifecycle evidence: `prepare` requires confirmation.

The repository is not installed, built, loaded, or executed by the static
contract tests in this checkout. Tests use a fixed local fixture and Fake
Adapters/Platforms.

## Deferred work

Release artifacts, signatures, topic scanning, persistent generations and
cross-platform script sandboxes remain deferred. Linux and Windows must remain
blocked for scripted preview until an equivalent sandbox Adapter exists. No
second Loader, runtime, profile root, or installation path may be introduced.
