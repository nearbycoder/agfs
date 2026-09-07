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

Implementation and local verification are complete. Activation status:

- PR #7 merged; migration 0006 and the web application are deployed. Main requires the passing `verify` CI job.
- The private CIMD container is deployed. Its public HTTPS and private-address rejection checks passed. Production discovery and authorization-start checks passed; the local integration suite covers discovery, consent, code exchange, and API access for an unregistered CIMD client.
- Workspace backup/restore passed. A production database-and-R2 archive was completed and verified on September 7, including database restore, search rebuild, and object checksums.
- npm 0.4.0 artifacts are prepared in a GitHub draft release. Trusted publisher activation still requires separate npm verification for SDK and CLI.
- Optional invitation email requires a verified sender and Resend key. Invitation links work without email.
- Cloudflare's independent Workers Builds check failed. Direct Wrangler deployment is verified; reading Builds logs requires additional account access unavailable to the current CLI login.
