# Agent Note: Desktop self-verification through chrome-use

Status: implemented

English | [中文](2026-08-23-desktop-verify-skill.zh.md)

## Problem

DSH Studio ships a desktop (Electron) surface whose features are mostly
model-visible: left rail, workbench surfaces, diff/comment rails, plugin
marketplace, settings. After a feature change, the team wanted an agent to
launch the DEV desktop, connect to it, and verify every function end to end.
Earlier attempts drifted into hand-written one-off scripts that poke the UI
directly (click/typing/eval payloads written for that day), which are
non-generic, short-lived, and bypass the accessibility-tree snapshot and
regression-suite facilities the installed browser automation skill already
provides. There was also no durable place to record the pitfalls of hooking
CDP automation onto this specific Electron app, so every agent re-solved the
same discovery problems from scratch.

## Decision

A repository-owned skill, [`dsh-desktop-verify`](../../../skills/dsh-desktop-verify/SKILL.md),
governs DEV-desktop self-verification. It launches the DEV channel via the
repository's own dev launcher (`pnpm run dev`, which already forces
`DSH_STUDIO_CHANNEL=dev` and opens CDP through its documented
`DSH_STUDIO_ELECTRON_ARGS` seam), connects with the installed `chrome-use`
CLI over CDP, and requires that **every UI interaction and assertion reuse
chrome-use's own capabilities** — snapshot/refs, find, click/fill/type/press,
wait/expect, eval, screenshot/record/HAR, and above all re-runnable YAML
suites via `chrome-use test <suite> --session <name>` — instead of ad-hoc
feature-triggering scripts. The only repository script the skill owns is a
process-lifecycle helper
(`scripts/ensure-dev-desktop.mjs`: ensure/status/stop/logs) that never drives
a feature; the app's own dev watcher restarts Electron on main-process bundle
changes, so the skill also documents the three reload paths (client HMR,
Electron restart, DSH Runtime restart) and mandates target re-discovery plus
suite re-runs after each.

Self-improvement is a hard requirement, not a suggestion: every pitfall is
appended to the skill's tracked `references/PITFALLS.md` (dated entries with
symptom/cause/fix/source), SKILL.md is amended when a described step is
wrong, and durable behavioral or contract changes raise an Agent Note
triplet. The skill defaults to the DEV channel (`~/.dsh-studio-dev`) and
never touches the installed production app (`~/.dsh-studio`).

## Alternatives considered

**Ship scripts that drive features directly.** Rejected: they duplicate the
snapshot/ref verification and console/network capture that chrome-use already
provides, rot against version and ref changes, and never converge into
re-runable regression coverage. The suite engine turns every feature check
into a durable case instead.

**Delegate all lifecycle to ad-hoc shell one-liners.** The single-instance
lock and the stale-daemon-after-restart failure modes are subtle enough that
one small, tested helper that wraps the official dev launcher reduces repeated
agent mistakes; everything else stays with chrome-use.

**Keep pitfalls only as agent notes.** Rejected for the skill's core loop:
pitfalls are consulted mid-run, so they must ride with the skill itself and be
updateable by any future agent without a separate notes workflow.

## Consequences

Feature verification on the DEV desktop is now one deterministic loop
(launch → connect → snapshot → suite → restart → re-discover → suite) built
entirely on the installed automation skill's capabilities, with evidence
landing under gitignored `tmp/desktop-verify/`. The tracked pitfall ledger
shortens the next agent's warm-up. The skill and its suite are versioned with
the repository, so CI-adjacent verification and agent self-checks can reuse
them. The helper must stay blind to features, and agents must resist writing
new triggering scripts whenever chrome-use's verbs already cover the step —
the PITFALLS ledger is the enforcement record.
