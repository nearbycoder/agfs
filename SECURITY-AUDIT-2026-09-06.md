# Security audit — September 6, 2026

Reviewed the application and CLI at `946d2809c8776bfad77773c4fd96e076a4754c1b`, after the agent-filesystem release. This is a source review with targeted local exploit/regression tests, a fresh dependency advisory scan, and production smoke checks. It is not an independent penetration test or evidence that the service has never been compromised.

## Confirmed findings and fixes

### High: a concurrent move could cross an API token's path boundary

The move route authorized source and destination paths, but `moveEntry` subsequently updated previously selected rows using only owner and entry ID. Between selection and the batch, another request could move a selected file outside the token's allowed path. The stale update would move that same ID back into the scoped destination. This required an authenticated token with write/delete permissions and an overlapping move by another authorized request; it did not bypass account ownership.

The fix materializes the current source subtree inside one SQLite update. It checks the source ID/path/kind, the vacant destination subtree, and the destination parent in that statement. A stale root fails with HTTP 409, and a child no longer in the source subtree is not moved. A newly conflicting destination leaves the subtree untouched.

Regression tests execute the SQL against real SQLite, including source relocation, child relocation, destination races, and literal dollar characters. Local D1 HTTP tests also verify allowed subtree moves and rejection of moves outside token scope.

Files: `apps/web/src/lib/fs.ts`, `apps/web/src/lib/move-statement.ts`, `apps/web/src/lib/move-statement.test.ts`.

### Medium: CLI downloads followed local links and could overwrite other files

CLI 0.2.0 opened download destinations directly for writing. A remote filename matching an existing file symlink, or a path containing a directory symlink, could redirect the write outside the intended download destination. Existing hard links could also cause another filename's content to be truncated. Exploitation required downloading attacker-controlled content into a location containing such links; remote content could not create a local link by itself.

Two tests against the actual CLI client failed on the old implementation, confirming file- and directory-symlink writes were accepted. The fix rejects symlink path components and non-regular destinations. Downloads are written to a private temporary directory and renamed into place only after completion and size verification, preventing hard-link truncation and preserving existing data on a failed transfer. Files are created with owner-only permissions.

Regression tests cover both symlink cases, hard-link isolation, truncated downloads, temporary-file cleanup, and a normal folder download. This is CLI patch version 0.2.1. Downloads through intentional symlink paths are now rejected; use the real path instead.

Files: `packages/cli/src/lib/safe-download.ts`, `packages/cli/src/lib/client.ts`, `packages/cli/src/lib/client-security.test.ts`.

## Other areas reviewed

- Session/bearer authentication, token management, ownership and path checks, and device-code claiming/consumption.
- Multipart ownership, size/quota reservations, completion, recovery/restore/purge, and object garbage collection.
- MCP per-request authentication, host/origin validation, REST authorization reuse, and tool input bounds.
- Preview ticket signatures, expiry, MIME restrictions, content disposition, and isolation headers.
- Public share expiry/revocation, SQL parameterization, tracked environment/config files, and executable HTML sinks.

The dependency audit reported zero known advisories across 448 dependencies. This does not establish the absence of undisclosed dependency vulnerabilities. The tracked environment files are examples; this was not a forensic scan of all historical commits or Cloudflare account access.

## Validation and limits

- `pnpm security:check`: workspace builds/typechecks and dependency audit passed; the final unit suites contain 63 passing tests.
- `node scripts/security-smoke.mjs`: 30 local HTTP security checks passed.
- `node scripts/features-smoke.mjs`: 60 local D1/R2/MCP feature/security checks passed.
- `node scripts/cleanup-smoke.mjs`: retention and object-cleanup checks passed.
- Production verification is limited to non-destructive public endpoint checks and Cloudflare deployment status. Exploit tests use disposable local data.

No additional confirmed high/critical findings were established in the reviewed paths. This review does not certify resistance to distributed traffic abuse, measure account-wide metadata growth limits, or protect against a hostile local process concurrently replacing the CLI's parent directories. Download destinations must be under the local user's control. Public share links remain bearer capabilities until revoked or expired; preview tickets remain valid for up to five minutes.

Implementation references: [SQLite materialization](https://www.sqlite.org/lang_with.html#materialization_hints), [Node filesystem semantics](https://nodejs.org/api/fs.html).
