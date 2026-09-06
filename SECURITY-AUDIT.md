# Security review — 2026-09-06

Scope: web/API source, authentication and authorization, D1/R2 data paths, shared content, CLI downloads and credential storage, dependency advisories, build/deployment configuration. This is a source review with regression and local integration tests, not an exhaustive penetration test or evidence that the service has never been compromised.

## Findings addressed

| Finding | Risk | Remediation |
| --- | --- | --- |
| Uploaded HTML/SVG served inline on the application origin | High: scripts could act with a visitor's application session | Force attachment downloads; sandbox CSP, nosniff, no-referrer, and private/no-store on all object responses |
| SQL LIKE applied to user-controlled folder names | High: `%`, `_`, and case folding could select or delete unrelated paths belonging to the same owner | Literal, case-sensitive prefix comparison, including Unicode paths |
| Reusable presigned R2 PUTs and unrestricted fallback upload bodies | High: committed content could be replaced after quota/metadata validation; uncommitted objects could consume unaccounted storage | Worker capability uploads only, exact Content-Length, conditional create-only R2 PUT, 100 MB/file ceiling, pending-space reservation and bounded cleanup |
| Non-atomic quota checks and upload replay | High: concurrent writes could exceed quota; repeated commit could replace a folder or restore deleted content | Guard quota and destination in SQLite write; atomically mark committed in D1 batch; reject non-pending/expired intents and root uploads |
| Device approval/poll races and temporary plaintext access tokens | High: concurrent consumers could receive the same token; abandoned device rows retained plaintext | Conditional approval/consumption; AES-256-GCM encryption of new temporary tokens; clear expired payloads on new device login |
| Missing API request protections | Medium: browser-origin confusion, unbounded JSON, cache exposure, internal database errors | Same-origin mutation checks, application/json requirement, 16 KiB JSON limit, sanitized internal failures, private/no-store API responses |
| Unthrottled authentication endpoints | Medium: device-code guessing and anonymous database-write abuse | Cloudflare rate-limit binding (60 requests/minute per client IP per location) for device and auth routes; strict device-code input bounds |
| CLI trusts remote filename components and base-URL overrides | High: a malicious server response could traverse local download paths; stored credentials could be sent to another host | Reject traversal, separators and drive prefixes; bind saved tokens to their server origin |
| CLI credential file initially created with default permissions | Medium: local token disclosure window | Private config directory; atomic replacement using a mode-0600 temporary file |
| Vulnerable dependency graph | Several critical/high advisories | Updated workspace dependencies and locked patched transitive esbuild versions; removed unused presigning dependency |

## Verification

- Initial pnpm audit: 59 advisories (3 critical, 31 high, 19 moderate, 6 low).
- Updated pnpm audit: zero known vulnerabilities, including development dependencies.
- All 43 workspace unit/regression tests, production build, CLI build and TypeScript checks passed.
- SQLite-backed regression tests for literal folder matching and atomic quota/destination conditions.
- Local Cloudflare Worker + migrated disposable D1 + R2: 30 HTTP checks covering auth, two-user isolation, upload/commit/replay, safe shares and revocation, and device approval/consumption.
- Local browser: homepage, CLI navigation and interactive elements rendered; no detected browser errors.
- Local GitHub OAuth initiation returned the expected provider URL; authentication throttling returned HTTP 429 with Retry-After.
- Tracked-source credential-pattern scan: no private keys, GitHub tokens or AWS access-key IDs found. This narrow pattern scan does not prove absence of every secret or inspect all git history.

## Operational notes

- Production host: Cloudflare Worker `agfs-dev-production`, domains `agfs.dev` and `www.agfs.dev`, deployed by the existing Git integration from `main`.
- No production database migration or credential rotation is required. Existing R2 S3 secrets are unused by the new app; they were not deleted or rotated during this change.
- Existing presigned URLs issued before deployment remain usable until their original expiration (up to 15 minutes). New URLs use Worker capabilities.
- Shared files now download rather than render inline. New uploads are limited to 100 MB each, while existing larger files remain downloadable. Storage-plan totals are unchanged.
- Rate limits are approximate and per Cloudflare location, not a globally strict quota. Storage quota is enforced by D1 independently.
- Cleanup is performed when an owner starts another upload. This is not a complete inventory or reconciliation of historical orphaned R2 objects.
- GitHub OAuth interactive sign-in needs the user's account and is not exercised using fabricated production credentials. Local tests use disposable users/API tokens; production checks are unauthenticated and non-destructive.
- CLI fixes are in the repository build; this change does not publish a new npm CLI release.
- Production builds now run workspace tests. Weekly Dependabot updates and `pnpm security:check` provide repeatable checks.
