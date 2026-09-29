# Current implementation contract

The authoritative models, canonical JSON, hashing and Ed25519 signing primitives are in `src/shared.ts`; request validation is in `src/registry/schemas.ts`. Node >=22.13.0 is required. The terminal user is anonymous and needs no account. Operator authorization uses an environment Bearer token and is separate from local MCP permission.

## Public HTTP API

List endpoints return `{items,total,offset,limit}` with `offset` and `limit` pagination unless noted. Public skill content requires `qualified` status, passing automatic checks, approved review and content-bound human purpose/boundary/all-host evidence. `approved` alone is insufficient. Pending/rejected content is never public. Revoked versions can expose safe status metadata but not instructions/resources/downloads.

| Method and path | Response / behavior |
| --- | --- |
| `GET /health` | `{status:'ok',version:'1.0'}`; process health only |
| `GET /v1/keys` | `{keyId,publicKey}`; pin explicitly at init/sync |
| `GET /v1/catalog` | `Signed<Catalog>` containing qualified versions; 15-minute expiry |
| `GET /v1/publication` | Signed pages of `{skill,bundle}`, default/max 10 items; same revision and 15-minute expiry |
| `GET /v1/publication/statuses` | Signed safe approved/needs-testing/revoked version metadata with the same publication revision |
| `GET /v1/search` | `SearchResponse`; latest qualified version per id; `q`, `category`, `host`, `sort=relevance\|newest\|name`, `limit`, `offset` |
| `GET /v1/skills/:id?version=VERSION` | `SkillDetail`; exact or latest qualified version; unavailable 404, revoked 410 |
| `GET /v1/skills/:id/versions` | `SkillVersionSummary` pages, default 50/max 100; status, qualification, reason, digest, hosts, exact dependencies, release metadata |
| `GET /v1/skills/:id/resources?version=VERSION&path=PATH` | Declared qualified resource content and hash/size; does not bypass qualification |
| `GET /v1/bundles/:digest` | `Signed<Bundle>` only for a currently qualified package; digest is hex `bundleDigest(payload)` |
| `GET /v1/qualifications/:digest` | `Signed<QualificationProof>` for public approved/revoked identity; 15-minute expiry; private versions 404 |
| `GET /v1/revocations` | `Signed<Revocations>` with exact id/version/digest and reason; 5-minute expiry |
| `POST /v1/ads/decision` | `AdRequest` → `Signed<AdDecision>`; requires `context:'normal'`, nonsensitive category and final-answer placement |
| `POST /v1/events` | `{token,type:'impression'\|'hide'\|'report',eventId,reason?}` → `{accepted:true,duplicate}` |
| `GET /r/:token` | Vetted redirect; one paid click debit, no repeated debit; invalid/expired/paused tokens fail |
| `POST /v1/inquiries` | `InquiryInput` including consent → `{id,duplicate,accepted:true}`; anonymous business lead |
| `POST /v1/reports` | `{requestId,campaignId,reason}` → `{id,duplicate,accepted:true}`; anonymous report |

Qualification proofs bind `id`, `version`, `digest`, `contentHash`, public `evaluation`, `qualification`, `generatedAt` and `expiresAt`. A legacy signed bundle can regain qualification through separately signed evidence without changing its version, bundle bytes or digest. Public summaries can therefore contain approved supplemental evidence absent from the original manifest; identity/content fields must still match the original bundle.

Advertising never changes organic ranking. Missing/unknown/sensitive context is suppressed with no house fallback. When permitted but no paid campaign matches, the Registry may return disclosed SkillFlux house advertising. There is no source code, complete prompt, answer or installation id in `AdRequest`. Authenticated preview uses its own endpoint and issues no decision token.

## Operator HTTP API

Every `/v1/admin/*` request requires `Authorization: Bearer <SKILLFLUX_ADMIN_TOKEN>`. Without a configured token the API is disabled. Development CLI may print a random token to its own stderr. Never put tokens into public variables, snapshot files, browser localStorage/sessionStorage or npm assets; the console keeps its token in page memory and clears it on disconnect/401/reload.

| Method and path | Purpose |
| --- | --- |
| `GET /v1/admin/skills` | All states, paginated |
| `POST /v1/admin/skills` | `Submission` with required full release metadata; automated scan and quarantine |
| `GET /v1/admin/skills/:id/:version` | Full private content, contentHash, evaluations, review history and prior-version diff |
| `POST /v1/admin/skills/:id/:version/evaluations` | `EvaluationInput`; purpose, boundary, host evidence, tester/date/environment, human or simulation |
| `POST /v1/admin/skills/:id/:version/review` | `{action:'approve'\|'reject'\|'revoke',reviewer,notes}`; approval gate and audited transition |
| `GET /v1/admin/campaigns` | Paginated campaigns; optional active/paused status |
| `POST /v1/admin/campaigns` | Validated `CampaignInput`; explicit operator-approved creative and budget |
| `PATCH /v1/admin/campaigns/:id` | Partial campaign changes; reservations and active tokens preserved/invalidated by policy |
| `GET /v1/admin/campaigns/:id/preview` | Disclosed preview only; no token, reservation or impression |
| `GET /v1/admin/inquiries` | Paginated business leads; retention cleanup |
| `PATCH /v1/admin/inquiries/:id` | `{status,operator,notes}`; workflow and closing time |
| `GET /v1/admin/reports` | Paginated report queue |
| `GET /v1/admin/reports/:id` | Report and associated campaign |
| `PATCH /v1/admin/reports/:id` | `{action:'dismiss'\|'pause',operator,notes}`; atomic resolution and optional campaign pause |
| `GET /v1/admin/metrics` | Date/campaign grouped metrics, `from`, `to`, `campaignId`, `groupBy` |
| `GET /v1/admin/metrics.csv` | Same metrics, escaped CSV |
| `GET /v1/admin/audit` | Paginated audit history, optional action and date filters |

Approval requires passing automatic checks and the latest actual human purpose/boundary/every-declared-host evidence bound to the submitted `contentHash`; an older passing assessment cannot bypass a newer failed human assessment, and simulation does not qualify. The first pending approval creates immutable signed content. A legacy public version can be reevaluated and approved at the same version using an external proof. Revoking a fixed dependency recursively revokes approved dependents. Development seeds remain pending and have no fabricated human evaluation.

Completed/invalid inquiries become eligible for PII cleanup 180 days after closing; active leads remain. Backups can retain older data and need a separate retention policy. Public summaries omit private test inputs/outputs and operator identity; public material is not proof that any arbitrary host or model version was tested.

## Runtime, plans and MCP

`skillflux init --project PATH --registry URL --host codex|claude|cursor|generic` modifies only the canonical project. Host MCP files are `.codex/config.toml`, `.cursor/mcp.json`, or `.mcp.json` for Claude/generic. Bootstrap is explicit-only: Codex metadata disables implicit invocation; Claude/Cursor frontmatter disables model invocation; generic is a manually loaded Bootstrap. The host must reload/enable the configuration.

Runtime pins Registry public identity through explicit TOFU. Registry URLs are HTTPS, except loopback HTTP; requests stay on the configured origin and reject redirects. Install plans are HMAC-sealed, expire, and bind exact packages/digests, project, Registry, host and lock revision. Plans never accept arbitrary model-provided URLs or paths.

`plan` selects installed locked versions by default. `install` executes only initial/reinstall plans; changing an installed version requires an exact update plan. MCP initial installation requires local `--preauthorize-reviewed-text`; a model consent boolean cannot override it. `skillflux.update` takes only the reviewed `planId` after explicit user approval, not a latest-version selector. CLI `update SKILL@VERSION` asks on a TTY or requires `--yes`; an unconfirmed noninteractive request returns a plan. `update` with no target is read-only.

`check-updates` / `outdated` and MCP `skillflux.check_updates` report current/latest compatible versions, changes, breaking flags, pinning, compatibility, revocation, time and cache source. Explicit checks refresh by default; ordinary version metadata caches for 24 hours. `pin` / `unpin` and MCP `skillflux.pin {skillId,pinned}` protect installed versions and dependency changes. Checking never installs. No process means no background update notification.

Installed packages are signed text, at most 512 KiB / 64 files, with per-file hashes. Shell, arbitrary network and secrets declarations are rejected rather than sandboxed. Manifest copies, sidecar qualification proofs, declared paths and undeclared files are checked. Reserved names include `manifest.json`, `.skillflux-envelope.json` and `.skillflux-qualification.json`. Package content cannot supply Runtime metadata.

Every plan/install/load/rollback checks online qualification; load independently checks revocations. Legacy packages require external signed evidence, stored separately from the unchanged bundle. Local proof corruption or cross-version substitution is rejected before refresh. Offline loading uses only previously verified package/proof/revocation data and discloses freshness/unknown status; offline install/update/rollback is not allowed. Signed loss of qualification is cached, preventing offline resurrection of an earlier grant.

Runtime checks current local permissions before installation/rollback/ad selection, including changes made after an MCP process started. Project writes are serialized; journal recovery and mutex paths reject symlinks. Failed preparation does not select a partial new version. Local edits block changes, except explicitly requested CLI force removal. Rollback restores a prior verified project lock, not an arbitrary version selector.

## Advertising accounting and output

`dailyCap` counts UTC paid decisions. Each paid token reserves the frozen CPC; a valid click records spend once. Available funds deduct spend and live reservations. Tokens expire within 10 minutes; campaign reads, relevant operations and a one-minute maintenance timer release expired reservations. Natural campaign end preserves earlier unexpired tokens; pause permanently invalidates outstanding tokens and releases their reservations, even after reactivation. Reports can pause campaigns transactionally. Event receipts bind every accepted event id to its original type/reason even when an impression itself was already deduplicated.

CTR is `clickedImpressions / paidImpressions` for the selected unique paid-impression UTC cohort, or null without a denominator; house impressions are excluded. Later clicks remain attributed to the original impression cohort for CTR, whereas `clicks` and `spentCents` use actual click/ledger dates. JSON metrics expose both counts and the ratio; CSV rows include clicked impressions and CTR. Do not recompute this ratio using daily click-event totals.

MCP returns advertising only as separate structured metadata and makes no final-answer-placement guarantee or impression claim. Managed `run -- EXECUTABLE ARG...` never uses shell interpolation; the explicitly selected child must read `SKILLFLUX_CONTEXT_FILE`. Only successful nonempty output with permitted context and a valid ad gets at most one appended disclosed line. Failed/empty output and ad-service failure get none. JSON mode preserves child output and advertisement in separate fields and does not record an impression. Output confirmation is not proof of human visibility or fraud-free traffic.

Ad events that cannot reach the Registry are stored in a bounded local outbox (at most 1000 entries, oldest dropped) and resent in order on the next Registry contact. A server deduplication response counts as delivered; permanently rejected events (for example expired decisions) are dropped; transient failures keep the remainder queued. Runtime results distinguish `reported`, `queued` and `unknown`; a queued impression is never presented as confirmed. Disabling advertising clears the outbox and blocks new events, including events queued before a long-lived process observed the change.

## Static website and operations

Public pages use a validated signed build snapshot, not per-page live catalog calls. `publication:sync` updates a snapshot after explicit trust; `publication:build` atomically switches a complete snapshot+dist release; `publication:watch` rebuilds on revision changes and retains the current release after failure. Any publication/qualification/revocation change requires sync, rebuild and redeployment to change public HTML. `PUBLIC_REGISTRY_URL` configures live console/forms, not automatic public content refresh.

Registry is single-instance SQLite with private persistent signing keys. `skillflux backup` (`--data-dir`/`--dest`, `--check --backup`, `--restore --backup --dest`; also runnable as `dist/registry/maintenance.js` with positional arguments) supports online consistent backup, signed integrity check and exclusive restore to a new directory. Backups contain plaintext private keys and business data and must be protected externally; supplying the known expected key id verifies continuity. Migrations refuse newer unsupported schema versions. See the repository operations guide for commands.

Request bodies are capped at 1 MiB; exact CORS allowlists and process-local rate limiting are enforced. Forwarding headers are trusted only from configured exact proxy IPs. TLS, infrastructure monitoring, contracts, npm publication and real third-party host/model execution are external operator actions, not automatically completed by the implementation.
