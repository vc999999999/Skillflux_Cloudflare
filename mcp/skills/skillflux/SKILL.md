---
name: skillflux
description: Explicitly search, install, load, and check updates for SkillFlux project skills from a curated GitHub-hosted skill marketplace when the user invokes $skillflux or directly asks SkillFlux to manage a skill.
---

<!-- skillflux-bootstrap:v2 -->

# SkillFlux

Use SkillFlux only for this explicit invocation. Do not invoke it implicitly for unrelated work.

1. Convert the request into a short capability query. Exclude source code, secrets, file contents, personal data, private names, and full user prompts.
2. Call `skillflux.search` with that capability query and the current host. The search runs locally over a cached catalog index, so the query never leaves the user's machine.
3. Choose the best reviewed match from the returned evidence. The catalog only lists approved versions with bound human purpose and boundary evaluations.
4. Call `skillflux.list` first. Reuse an installed locked version with `skillflux.load` unless the user requests a version change. For a new skill, call `skillflux.plan` for the selected skill. Explain any returned permission or compatibility issue instead of bypassing it.
5. Call `skillflux.install` with only the returned `planId`. Never invent a URL, filesystem path, digest, approval value, or plan identifier. Files are downloaded from a pinned catalog commit and verified against their sha256 hashes.
6. Call `skillflux.load` for the installed skill and request only resources needed for the task.
7. Follow the loaded entry instructions while preserving the user's original request and authority boundaries.

For update requests, call read-only `skillflux.check_updates` with `force: true`. Report current and latest compatible versions, release notes, breaking changes, pins, check time, cache source, and unknown or revoked status. A lightweight notice on explicit `load` uses a 24-hour catalog index cache; revocation status comes from the same index. Offline cache data cannot establish that an installed version is current. Checking never authorizes installation.

When the user selects an exact new version, call `skillflux.plan` with that `version`, show every returned change, and obtain the user's explicit approval of that concrete plan before calling `skillflux.update` with its `planId`. Existing install preauthorization does not authorize upgrades. Never silently change a pinned version; `skillflux.pin` with `pinned: false` requires the user's request to unpin. Explain local edits, incompatibility, expired plans or revoked targets. Rollback also checks revocations and preserves pins and edited files.

If the catalog index cannot be reached, `load` may still verify previously installed content while disclosing that current catalog status is unknown; it does not authorize installation or upgrading in that state.

If search, verification, installation, revocation checking, or loading fails, report the concrete failure. Do not substitute an unreviewed package or continue from partially installed files.
