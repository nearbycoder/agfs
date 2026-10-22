# Maintenance deployment — 2026-10-22

Implementation commit: `339a609349526aab2d8167f9f235237c000fca4e` (`Refresh dependencies and deliver 70 performance improvements`). The dependency refresh, 70 performance improvements, and security fixes are described in the [maintenance report](performance-expansion-2026-10-22.md) and its linked reports.

## Deployed resources

| Resource | Active version / change |
| --- | --- |
| Web: `agfs-dev-production` | `aaa733b0-1011-4582-945c-970763d4740d` |
| Preview: `agfs-preview` | `518e7ada-90f0-42d6-b3ba-86e79fcfc31e` |
| CIMD: `agfs-cimd-egress` | `7fcc0095-ee4b-4930-a5fb-a03fcf934853` |
| CIMD container | `docker.io/library/node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205` |
| D1: `agfs-db` | Migrations 0014–0017 applied before new web activation |

The web app serves [agfs.dev](https://agfs.dev) and [www.agfs.dev](https://www.agfs.dev); the separate preview Worker serves [preview.agfs.dev](https://preview.agfs.dev). Both the CIMD Worker upload and its Container application update completed. Existing production variables and secrets were preserved; no new secret was required. No package was published.

## Validation

Before deployment, the final source passed 618 workspace tests, 27 Python tests, all workspace builds/typechecks, the complete local Worker integration suite, browser flow checks, and full/production dependency audits with zero known findings. The production build reran all 618 workspace tests and passed its web typecheck.

After web reactivation, all 22 production smoke checks passed:

- Homepage availability and security header; four served assets matched the production build byte-for-byte.
- Unauthenticated listing and ranged downloads returned 401 on both production domains.
- MCP retained its authentication challenge; OAuth discovery advertised the production endpoints and CIMD support.
- Preview GET and HEAD rejected invalid tickets with isolation headers; HEAD returned no body.
- The deployed CIMD container fetched the app's public discovery JSON and correctly rejected it as invalid client metadata. This exercised real container transport without creating a user, client registration, or file.

The remote migration list reported no pending migrations. A read-only consistency query found no missing, mismatched, or orphaned queue-owner projection rows.

Thirty additional production authorization probes passed between 16:53:05 and 16:56:07 UTC, including concurrent requests to both domains. Four scheduled runs between 16:52 and 16:55 UTC completed on the maintenance version with `outcome: ok` and no reported exception. A final API read confirmed all three listed Worker versions were active at 100% traffic.

## Initial rollout interruption

The first web activation intermittently stalled unauthenticated listing requests. Worker tail events confirmed canceled requests with little CPU work and no reported exception. The web Worker was promptly rolled back to `0eb97275-ff4b-4bee-9c12-340c50002338`; the additive migrations and the working preview/CIMD deployments remained in place.

Investigation retrieved the exact previous deployed bundle through the version-specific Cloudflare API. The ordinary script-content download endpoint returned the latest uploaded bundle despite rollback, so it was not used as the previous baseline. The relevant emitted Better Auth, TanStack, Drizzle, application auth, and listing code matched after chunk-name normalization. Local cold/concurrent requests, scheduled overlap, cancellation experiments, module-graph checks, and a private Cloudflare remote session did not reproduce the stall.

The unchanged maintenance version was then added at 0% normal traffic and exercised through explicit version-override requests. Tail records confirmed the requested version. Its homepage, authorization checks, twelve concurrent listings across both domains, and the full smoke suite passed. The same version was reactivated at 100% at approximately 16:52 UTC, and the full smoke suite passed again without overrides.

No source defect was established and no speculative code patch was applied. A deployment/isolate lifecycle explanation remains a hypothesis, not a confirmed root cause. Temporary diagnostic instrumentation was prepared and locally tested but was never deployed. Production remains on the reviewed implementation bundle.

## Operational limits

The production probes used public endpoints and invalid or absent credentials. Authenticated file mutation, retention, transfer integrity, and queue lifecycle were covered by disposable local integration fixtures rather than production user data. The initial stall's root cause remains unresolved; successful subsequent checks do not establish that it cannot recur.

If it recurs, the prior web version remains a compatible rollback target with migrations 0014–0017 installed. Preserve version-specific tail evidence before changing code. Local verification artifacts and temporary diagnostic files are not part of the release.
