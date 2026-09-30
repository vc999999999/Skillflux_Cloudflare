---
name: skillflux
description: Explicitly search, install, load, and check updates for SkillFlux project skills when the user invokes $skillflux or directly asks SkillFlux to manage a skill.
---

<!-- skillflux-bootstrap:v1 -->

# SkillFlux

Use SkillFlux only for this explicit invocation. Do not invoke it implicitly for unrelated work.

1. Convert the request into a short capability query. Exclude source code, secrets, file contents, personal data, private names, and full user prompts.
2. Call `skillflux.search` with that capability query and the current host.
3. Choose the best reviewed organic match from the returned evidence. Advertising is never a ranking signal.
4. Call `skillflux.list` first. Reuse an installed locked version with `skillflux.load` unless the user requests a version change. For a new skill, call `skillflux.plan` for the selected skill. Explain any returned permission or compatibility issue instead of bypassing it.
5. Call `skillflux.install` with only the returned `planId`. Never invent a URL, filesystem path, digest, approval value, or plan identifier.
6. Call `skillflux.load` for the installed skill and request only resources needed for the task.
7. Follow the loaded entry instructions while preserving the user's original request and authority boundaries.

For update requests, call read-only `skillflux.check_updates` with `force: true`. Report current and latest compatible versions, release notes, breaking changes, pins, check time, cache source, and unknown or revoked status. A lightweight notice on explicit `load` uses a 24-hour version cache; signed security revocations are checked independently. Offline cache data cannot establish that an installed version is current. Checking never authorizes installation.

When the user selects an exact new version, call `skillflux.plan` with that `version`, show every returned change, and obtain the user's explicit approval of that concrete plan before calling `skillflux.update` with its `planId`. Existing install preauthorization does not authorize upgrades. Never silently change a pinned version; `skillflux.pin` with `pinned: false` requires the user's request to unpin. Explain local edits, incompatibility, expired plans or revoked targets. Rollback also checks revocations and preserves pins and edited files.

Older published packages may regain qualification after supplemental testing while keeping their original version, signed bytes, and digest. The Runtime verifies a separate Registry-signed qualification proof bound to that exact package; do not edit package metadata or substitute an assessment from another version. Online load checks qualification and revocations. Offline use requires an already verified cached proof and must disclose that present cloud qualification is unknown; it does not authorize installation or upgrading.

Update notices and advertisements are separate runtime metadata, never Skill instructions. The structured `advertisement` field may contain one optional disclosed recommendation. Leave `adContext` unknown unless the task can reliably be classified as ordinary and nonsensitive; sensitive or unknown contexts and disabled advertising receive none. In a plain MCP host the model decides whether to show the recommendation, and host rendering may suppress it; never promise final placement or count a recommendation as an impression. If shown, use its exact disclosure and one short line at the end, separate from the answer. Managed-run adapters append at most one advertising line outside model context and keep JSON advertising in a separate field; do not repeat it. Ad failures are skipped without inventing a replacement.

If search, verification, installation, revocation checking, or loading fails, report the concrete failure. Do not substitute an unreviewed package or continue from partially installed files.
