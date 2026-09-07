# Reliability and scale release

Requested scope: all twenty improvements proposed after AGFS 0.3.0.

- [x] 1. OIDC npm release workflow and package installation gates
- [x] 2. Pull request CI including disposable integration fixtures
- [x] 3. Consistent backup/export, checksum verification, restore drill
- [x] 4. Authenticated operation burst limits
- [x] 5. Token/webhook rotation, expiry and last-used visibility
- [x] 6. Secret scanning and reviewed public sharing
- [x] 7. Idempotency keys for creation requests
- [x] 8. Atomic workspace snapshots and restore
- [x] 9. Durable changes feed and incremental CLI sync
- [x] 10. Queue workers with transactional outbox and dead letters
- [x] 11. Cursor pagination in API, SDK, and interface
- [x] 12. Bounded concurrent transfers with cancellation/backoff
- [x] 13. Index status and safe reindex
- [x] 14. Operational metrics, thresholds, and alerts
- [x] 15. SDK browser OAuth, refresh, secure token persistence
- [x] 16. MCP CIMD with restricted network access
- [x] 17. Draft diffs, comments, requested changes, independent review policy
- [x] 18. Run input/output retention pins
- [x] 19. Invitation lifecycle/email and accepted ownership transfer
- [x] 20. CLI conflict commands and safe stale-lock recovery

Verification: unit tests for security/concurrency boundaries, full builds/typechecks,
disposable local D1/R2 integration and restore checks, browser verification, package
installation, production deployment smoke checks. External configuration gaps must
be reported explicitly rather than described as activated.

Implementation and local verification are complete. Activation status is separate:

- CI files are ready; main branch now requires the `verify` job.
- npm trusted publishers still require account verification for SDK and CLI.
- CIMD Node egress passes local public-fetch and private-address rejection checks; Cloudflare container activation requires refreshed CLI permissions. CIMD stays disabled until its service binding is configured.
- Optional invitation email requires a verified sender and Resend key. Invitation links work without email.
- Workspace backup/restore passed. Production ordinary-table D1 export restored locally; the full service archive requires R2 read access.
- Merge, production migration/deployment, and registry release are pending.
