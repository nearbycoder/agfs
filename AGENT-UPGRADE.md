# Agent filesystem upgrade

This release adds scoped expiring credentials, recoverable files, isolated previews, resumable uploads, activity history, and stateless MCP. It includes the latest stable versions of every existing direct dependency as checked against npm on September 6, 2026.

## Behavior

- New tokens default to 30 days and allow at most 90 days. Folder boundaries are normalized, case-sensitive, and literal. Read, write, delete, share, and account-management permissions are enforced by the same REST routes used by MCP. An explicit bearer token takes precedence over a browser session. Existing tokens retain their previous permissions and expiry.
- Deleted files and overwritten versions remain recoverable for 30 days. Folder removal and restoration use atomic D1 batches. Restore uses a vacant destination and never replaces current data. Shared links to deleted entries are removed. Retained objects count toward quota once, including after restoration.
- A durable garbage-collection queue makes R2 deletion retryable and protects objects still referenced by live files or versions. The hourly job cleans abandoned uploads and expired recovery data, revokes unused device tokens, and prunes old activity. Incomplete multipart uploads also have R2's default seven-day abort lifecycle as a fallback.
- `preview.agfs.dev` is a separate Worker with only an R2 binding and a dedicated signing secret. Its five-minute tickets permit images, PDFs, or plain text. HTML, XML, and logs render as text; SVG is never served as an active image. The Worker serves no application routes, uses no auth cookies, and returns sandbox/no-store/nosniff headers.
- Web and CLI uploads use authenticated 8 MiB parts with per-part SHA-256 comparison on resume. Limits are 20 GB per file and the account's quota. Uploads expire after 24 hours. Completion is retryable and checks the actual R2 size plus atomic quota predicates. Legacy single-request uploads keep the 100 MB cap and create-only capability behavior.
- Activity identifies the web user or token label/ID and retains 90 days of successful file operations. Activity and recovery support cursor pagination and scope filtering. Audit failures are logged without changing an already completed operation.
- `/mcp` uses official SDK v2 `createMcpHandler`, supporting 2026-07-28 and legacy stateless Streamable HTTP. Every request authenticates independently; no MCP session IDs or sticky routing. Clients supply AGFS bearer tokens manually. OAuth discovery is not advertised.

## Compatibility

TypeScript is now 7.0.2, Vitest 5.0.0, Commander 15.0.0, and MCP SDK 2.0.0. The CLI requires Node 22.12 or newer. The executable package no longer generates unused library declaration files through tsup; TypeScript checks run separately. Better Auth's optional test-integration peer range does not yet include Vitest 5; AGFS does not use that integration, and its tests pass on Vitest 5.

The updated CLI is version 0.2.0 in this checkout. npm publication is a separate release step. Existing installed CLI versions continue to use the compatible small-upload API.

## Verification

- `pnpm security:check`: zero known advisories; 54 unit tests; all workspace builds and typechecks.
- `node scripts/security-smoke.mjs`: 30 local HTTP regression checks.
- `node scripts/features-smoke.mjs`: 54 local integration checks, including real D1/R2 multipart resume, ownership/scope isolation, recovery, preview integrity, and the official MCP client in both protocol generations.
- `node scripts/cleanup-smoke.mjs`: recursive permanent deletion, R2 garbage collection, expired multipart abort, and unused device-token revocation.
- Signed-in browser inspection of token scope controls, recovery, activity, and navigation.

All test fixtures and destructive verification are local only. Production deployment requires additive migrations `0002_agent_filesystem.sql` and `0003_object_gc.sql`, the shared preview signing secret on both Workers, and deployment of the preview Worker before enabling the new application build.

## Rollout

1. Export the D1 schema/data or note its Time Travel recovery point.
2. Apply the two additive migrations before merging the production branch.
3. Provision the dedicated random preview secret on both Workers and deploy the preview Worker/custom domain.
4. Merge the tested branch and deploy the app; verify its version, routes, headers, and hourly cron configuration.

Do not roll back to code that physically deletes overwritten R2 keys after recovery has been enabled: that older behavior can destroy retained versions. A forward fix is the safe default. Database migrations intentionally preserve existing entries, credentials, and shares.
