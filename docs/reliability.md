# AGFS 0.4: reliability, recovery, and scale

## Recovery and retained artifacts

Operations & recovery (`/app/operations`) creates folder or workspace snapshots. A snapshot captures metadata and object references in one database transaction. Restore archives the current files and replaces the selected folder atomically; old public shares are revoked. A person must restore through a browser session. Snapshot retention is 1–90 days, at most 100 snapshots per namespace and 10,000 entries per snapshot. Retained physical objects count once toward storage.

Runs now pin their inputs immediately and their outputs on completion. `retentionDays` defaults to 30 (maximum 90); completing a run extends input retention for the same period. A run that outlives its input retention cannot complete using missing versions. Download a retained file with `GET /api/v1/platform/runs/:id/file?path=/file&kind=input` (or `kind=output`). Existing 0.3 runs do not retroactively recover expired content.

Portable backups include a consistent snapshot's file metadata and contents, plus SHA-256 checksums. This is a workspace-content backup, not a backup of accounts, OAuth secrets, or the entire service database. Protect the backup directory as you would your private files.

```sh
# Set AGFS_TOKEN securely in the environment. A management token is required.
node scripts/backup.mjs export ./backup /reports
node scripts/backup.mjs verify ./backup
node scripts/backup.mjs restore ./backup /restored-reports
```

Restore verifies every backup object first, writes into an empty dedicated destination with create-only preconditions, then downloads and verifies each restored file. Interrupted portable restores can leave partial files in that destination; live snapshot restores are atomic. The export's temporary remote snapshot expires after one day. For service disaster recovery, `node scripts/service-backup.mjs export PRIVATE_DIRECTORY` archives all ordinary D1 tables in one export plus each currently referenced or retained R2 object. `verify` imports that database into temporary SQLite, rebuilds the derived FTS search table, checks database integrity, and verifies every object checksum. This requires Wrangler permissions for D1 and R2. Exports include account and OAuth secrets: keep the directory private (0700). D1 exports briefly block database requests. An unavailable object makes the archive incomplete; retry into a new directory. Completed archives exclude expired retained objects and unfinished multipart uploads. After an operator restores the database and R2 objects, discard unfinished upload reservations and rebuild search before serving traffic. The tool does not overwrite production during verification.

## API safeguards

Authenticated burst limits apply per namespace and actor: search permits 60 operations per minute, other operation classes permit 300. Existing daily budgets still apply. A rejection returns 429 and `Retry-After: 60`. Cloudflare rate limiting is a regional abuse-control mechanism, not a globally exact billing counter.

`Idempotency-Key` (8–128 printable characters) is supported on POST `/api/v1/platform/runs`, `/platform/drafts`, `/shares`, `/fs/upload-intents`, and `/fs/resumable` (all under `/api/v1`). Keys are bound to the authenticated actor/token, permissions, workspace, method, route, and exact JSON body. Replays return the saved response and `Idempotency-Replayed: true`; reuse with another body returns 409. Responses containing credentials are encrypted in D1. Reservations last 24 hours; a crash with an uncertain outcome keeps its reservation and returns 409. Inspect resources before choosing a new key. This prevents duplicate execution during the retention window; it does not claim exactly-once delivery across a crash or after expiration.

Public sharing scans small file contents for private-key headers, common token formats, and assigned secrets. Findings show types and line numbers, never values. Text review is limited to 1 MiB; larger text files cannot be shared through this flow. Pattern scanning is heuristic and does not guarantee a file is secret-free. A person may explicitly approve the reviewed ETag in the browser. API tokens cannot override findings. Content changes revoke existing links.

API token rotation keeps the same token identity, scope, expiry, and budgets. The previous secret remains usable for up to 15 minutes; revocation or pause affects both secrets immediately. OAuth grants are reauthorized through OAuth. Webhook rotation emits both old and new signatures during its 15-minute overlap. Accept any valid `v1` signature after checking timestamp freshness and event deduplication. Last-use timestamps and upcoming credential expirations are visible in Tokens, Webhooks, and Operations.

## Sync and SDKs

`GET /api/v1/platform/changes?path=/reports` obtains a checkpoint. Add `since` to get ordered upserts/deletions. Continue with `nextCursor` as `since`, holding the response's `checkpoint` in `through`. History is retained for 30 days; 410 requires a full rescan. Filesystem triggers write changes in the same transaction as the file mutation, including both sides of a rename.

CLI sync caches remote entries and checkpoints; subsequent runs fetch changes rather than walking every remote directory. Local files are still hashed for correctness. Ignore-rule changes and expired checkpoints trigger a full scan. Transfers default to three concurrent files, with an adjustable limit of 1–8. Ctrl+C cancels SDK requests and stops new work. Completed-file state writes are serialized.

```sh
agfs sync ./reports /reports --concurrency 4 --dry-run
agfs sync ./reports /reports --resolve local --file summary.txt
agfs sync ./reports /reports --resolve remote --file summary.txt
agfs sync ./reports /reports --resolve both --file summary.txt
agfs sync-unlock ./reports
```

Conflict output shows local SHA-256 and remote ETag. `both` preserves the remote copy in a uniquely named local sibling and writes the chosen local version conditionally; the next sync uploads that preserved sibling. Other unresolved conflicts stop the plan. Stale-lock recovery only removes a lock from the same host after confirming the recorded process is gone; old/unverifiable locks fail closed.

Search, runs, drafts, and snapshots return `nextCursor`, and their web interfaces can load more pages. SDK `searchAll`/`search_all` and `pages` iterate cursors. Cursors are bound to search filters where applicable; they are continuation points, not immutable result-set snapshots.

TypeScript Node applications can import `OAuthSession` and `fileCredentialStore` from `@agfs/sdk/oauth`; Python applications use `agfs_sdk.oauth`. Both implement browser authorization with a loopback callback, PKCE S256, state verification, issuer checks, same-origin endpoints, refresh-token rotation, and optional private credential files. Keep one session instance per credential store/process. Never put credentials in a project directory. The TypeScript core client remains usable without the Node OAuth module.

```ts
const session = await OAuthSession.login({
  onAuthorizationUrl: (url) => console.log("Open:", url),
  store: fileCredentialStore("/home/me/.config/agfs-sdk/credentials.json"),
});
const client = new AgfsClient({ token: session.token });
```

## MCP metadata discovery

Better Auth's CIMD plugin adds MCP 2026-07-28 Client ID Metadata Documents when the private `CIMD_EGRESS` service binding is configured. The service uses Better Auth's official Node transport: resolve DNS once, reject every special-use result, pin the selected address, preserve TLS hostname verification and SNI, and never follow redirects. It bounds response size to 128 KiB, upstream fetch time to ten seconds, and concurrent requests to four. Metadata caches and per-origin fetch budgets are also bounded.

`apps/cimd-egress` runs the bundled transport in a digest-pinned official Node image on Cloudflare Containers. It has no public route, one maximum instance, and sleeps after thirty seconds idle. Containers incur usage charges while active and have cold-start latency. Deploy it with `pnpm --filter @agfs/cimd-egress deploy`, then configure the production web Worker's `CIMD_EGRESS` service binding to `agfs-cimd-egress`. Without that binding, CIMD is disabled and DCR remains available. The service is separate because Workers' current pinned-IP TLS transport fails hostname verification; do not replace it with an unpinned fetch or disable certificate verification.

## Background jobs and operations

D1 index jobs and webhook deliveries remain the durable source of work. Cloudflare Queues dispatches work shortly after mutations, while the minute cron recovers missed sends and schedules due retries. Indexing is version-conditional; webhook delivery remains at least once. Duplicate queue deliveries are safe. Queue failures are captured by `agfs-background-dead`; exhausted index work requires reindexing, and failed webhooks can be retried from their delivery history. Scheduled processing remains available when queue bindings are absent in development.

Operations shows per-class request counts, server errors, rejected operations, average handler latency, indexing backlog, failed jobs, webhook status, and expiring credentials. Configurable thresholds generate in-app alerts. Latency measures handling through response creation, not the duration of downloading a streaming body. Metrics retain seven days; resolved alerts retain thirty days. This release does not send operational alert emails.

## Reviews and workspace administration

Drafts have line diffs, discussion comments, requested changes, and author resubmission. Owners can require independent review. With independent review enabled, another workspace editor or owner can review a draft; its author cannot approve it. Without that policy, approval requires management permission.

Owners can list/revoke pending invitations and request an ownership transfer to an existing member. The recipient must accept within 24 hours; account storage and workspace-count limits are checked. The original owner becomes an editor. Tokens continue to intersect their issuer's current membership and role.

Optional invitation email uses Resend. Set Cloudflare secrets `RESEND_API_KEY` and `INVITE_FROM_EMAIL` to a verified sender. The UI only sends email when explicitly selected. If delivery is unconfigured or fails, the invitation link remains available. No automatic invitation or test messages are sent during deployment.

## Release automation

`CI` runs dependency audits, tests, builds, typechecks, Python tests, and disposable local D1/R2 HTTP checks. GitHub Actions are pinned to commit hashes. The publish workflow uses npm OIDC trusted publishing, an `npm` GitHub environment, public provenance, and tarball executable checks. Configure both npm packages to trust `nearbycoder/agfs`, workflow `release.yml`, environment `npm`. GitHub requires the workflow OAuth scope to push workflow files. Registry trust and repository protection are external configuration, not enabled merely by committing YAML.
