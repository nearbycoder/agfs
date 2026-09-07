# AGFS collaborative agent platform

This release adds ten capabilities while retaining personal files, legacy API tokens, and stateless MCP. The web controls live under `/app`; all API routes require a session or token and enforce the selected namespace and path scope.

## 1. Search and tags

`GET /api/v1/platform/search?q=release&path=/reports&type=text/plain&tag=approved` searches filenames and indexed text with optional type and tag filters. `nextOffset` paginates 50 results at a time. Filenames work immediately. A once-per-minute worker indexes UTF-8 text and common text application types up to 1 MiB. Results can lag a minute (longer while a backlog drains); overwritten content is excluded until its current object is indexed. Search is lexical, not semantic.

`PUT /api/v1/platform/tags` accepts `{path,tags}`: up to 20 unique tags, 40 characters each. Search authorization filters by namespace and literal folder boundaries.

## 2. Browser OAuth for MCP

Connect an OAuth-capable MCP client to `https://agfs.dev/mcp`. Discovery is available at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server/api/auth`. OAuth 2.1 authorization code flow uses PKCE S256, explicit resource/audience binding, signed consent parameters, refresh tokens, and the Better Auth MCP provider. Dynamic client registration is enabled; native clients must declare `application_type: native` when registering loopback HTTP redirects. Client ID Metadata Documents are not enabled in this release.

The browser lets a person select the workspace, folder, and requested read/write/delete/share permissions. Connections appear in Tokens and Agent budgets. Each approval creates a separate 30-day grant; revoking or pausing the grant takes effect on subsequent API requests. OAuth never grants account-management permission. Workspace membership and current roles are checked for every request. The stateless server supports both legacy Streamable HTTP negotiation and MCP 2026-07-28. API keys remain supported.

## 3. Shared workspaces

Create a team workspace in Workspaces, then select it in the sidebar. Personal files remain in Personal. Owners manage members, tokens, budgets, and webhooks; editors can read/write/delete/share; viewers can read. The original owner cannot be removed or demoted. Up to ten workspaces per creator are supported.

Invitations are email-bound, single-use links valid for seven days. AGFS returns a link for you to send; it does not email the recipient. The recipient must sign in with the matching email. Removing a member removes access through their workspace tokens too. Tokens are permanently bound to one namespace; `X-AGFS-Workspace` cannot grant access to another one.

## 4. Conditional writes

Upload intents and resumable upload requests accept `ifMatch`: omit for existing unconditional behavior, use `null` to create only, or pass the current entry's ETag to replace exactly that version. The condition is checked in the atomic database commit, so two uploads prepared against the same base cannot both overwrite it. Conflicts return 409. Browser uploads use the version from the visible file list.

Downloads accept `If-Match` and return 412 if the version changed. Individual-file deletion accepts `ifMatch` and returns 409 on a stale version. Retained versions still count toward storage quotas.

## 5. Signed webhooks

Owners create a public HTTPS endpoint, select a folder, and subscribe to events (`*` means all). Events are durably queued in the same database transaction as their activity record. Delivery is at least once, with eight attempts, exponential backoff, a ten-second request timeout, and no redirects. Pause endpoints and inspect or retry failed deliveries in Webhooks.

Headers: `X-AGFS-Event-ID`, `X-AGFS-Timestamp` (Unix seconds), and `X-AGFS-Signature: v1=<hex>`. Verify HMAC-SHA256 over `timestamp + '.' + exact_request_body` with the secret shown at creation. Compare in constant time, reject timestamps older than five minutes, and deduplicate event IDs. HTTPS endpoints must be publicly routable; Workers public-only egress is enabled.

## 6. Agent runs

Start a run with a name, output folder, optional input file paths, and string metadata such as a source revision. Complete it after writing artifacts. AGFS saves an immutable manifest of the observed input versions and output paths, sizes, ETags, available R2 SHA-256 checksums, actor, token, metadata, and timestamps. Up to 50 inputs and 200 output artifacts per run are supported. A manifest records provenance; it does not retain artifacts beyond the normal file/version retention policy or prove that an agent executed a particular process.

## 7. Draft change sets

Agents or people create a draft and add individual text-file writes or deletions under its folder. Existing text files up to 64 KiB can be reviewed; each proposed write is capped at 8,192 characters and the draft at 30 files. The interface shows before and after content. A person with management permission approves or rejects it. Approved drafts are immutable; applying rechecks all base versions and commits every live-file change atomically. Any conflict stops the whole apply. Create destination folders before applying a draft. Staged objects from failed attempts expire through normal upload cleanup.

## 8. CLI sync and watch

```sh
agfs sync ./reports /reports --dry-run
agfs sync ./reports /reports
agfs watch ./reports /reports --interval 5
agfs sync ./reports /reports --delete
```

Create the remote root folder first. Sync is bidirectional and uses local SHA-256 plus remote ETags, not timestamps. If both sides changed, it reports conflicts before changing any files. Resolve those copies and rerun. Deletions only propagate for previously tracked files when `--delete` is present. Empty directories are not synchronized. `watch` polls (minimum two seconds); Ctrl+C stops it. Watch stops on a conflict or error so it cannot silently overwrite unresolved work.

`.agfsignore` supports `*`, `**`, `?`, directory patterns, and comments (no negation). `.git`, `node_modules`, `.env*`, and `.agfs-*` state are always ignored on both sides. Symlinks and special files are refused. Local `.agfs-sync.json` binds progress to the account, workspace, server, and remote root. A lock prevents concurrent sync commands; if a process is forcibly killed, remove `.agfs-sync.lock` only after confirming it is no longer running. Dry runs do not change synchronized files or state, but acquire a temporary lock.

## 9. Official SDKs

TypeScript: `packages/sdk` (`@agfs/sdk`). Python: `packages/python-sdk` (`agfs-sdk`). Both include authenticated requests, conditional writes, search pagination, retries for safe operations, bounded-memory resumable uploads, runs, and drafts. Package READMEs contain examples. Python can be installed directly from the repository; PyPI publication is separate from the deployed service.

## 10. Budgets and pause controls

Owners set per-agent storage bytes, daily upload bytes, and daily operation limits. Blank means no additional agent limit; zero blocks that budget. Upload reservations count toward daily uploads even if abandoned, preventing repeated failed transfers from bypassing the cap. Operations count API requests (including each multipart part); one MCP tool may make multiple API calls. Daily counters use UTC. Stored bytes include retained objects attributed to that token until permanent cleanup. The interface warns at 80% and lets owners pause agents immediately.

Workspace owners can lower the workspace storage budget within the account plan and pause writes/deletions/new shares. Reads remain available while a workspace is paused. Per-agent and workspace limits supplement existing quotas.

## Release verification

`pnpm test`, web production build/typecheck, SDK and CLI builds/typechecks, Python unittest, and local D1/R2 smoke tests cover the release. `scripts/platform-smoke.mjs`, `oauth-smoke.mjs`, and `sync-smoke.mjs` require the disposable localhost fixture database at `/tmp/agfs-audit-state`; never point them at production. Migrations 0004 and 0005 must be applied before the new Worker is activated. Both are additive to the previous release.
