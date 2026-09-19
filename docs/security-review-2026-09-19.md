# Security and dependency review — September 19, 2026

This pass reviewed workspace ownership and credential lifecycle, bounded upload handling, session/OAuth/MCP authorization, consent and request-origin checks, share/preview isolation, outbound metadata/webhook requests, and dependency advisories. It supplements the earlier September review; it is not an exhaustive penetration test.

## Fixes

- **Cancelled ownership offers on member removal.** A pending offer previously survived removal and could be accepted after reinvitation. Removal now deletes the offer in the same D1 transaction that revokes credentials and removes membership.
- **Prevented partial ownership changes during membership races.** Acceptance previously checked affected rows after the transaction committed. If a participant disappeared between authorization and execution, the remaining role and billing owner could still change despite the error response. Both memberships are now required by each mutation's transactional guard. Proposal creation also rechecks the current owner at execution time, preventing a stale request from replacing a newer owner's offer.
- **Bounded actual multipart upload bytes.** Part uploads previously called `arrayBuffer()` before checking the resulting size, relying on the HTTP layer's Content-Length enforcement. A streaming reader now retains at most the expected part size (maximum 8 MiB), rejects short bodies, and cancels oversized streams before hashing or writing to R2. This is defense in depth; no production HTTP framing bypass was demonstrated.

Five ownership regression tests cover successful transfer, each missing participant, removal/reinvitation, and stale owner authorization. Four upload-reader tests cover exact, short, oversized, and absent bodies. The ownership tests reproduced four failures before the fixes. The disposable HTTP suite also verifies that reinvitation cannot revive an ownership offer.

## Dependency refresh

All outdated direct npm dependencies were updated to the registry's stable versions available during this pass. Existing esbuild and sharp security overrides remain in place. No new packages or services were introduced.

| Area                               | Updated versions                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Authentication and MCP integration | Better Auth, CIMD, Drizzle adapter, MCP plugin 1.7.5                                                    |
| React                              | React / React DOM 19.3.0; React types 19.3.0                                                            |
| TanStack                           | Router 1.170.38; Start 1.168.56; router devtools 1.167.2                                                |
| Cloudflare                         | Wrangler 4.135.0; Vite plugin 1.56.0; Workers types 5.20260919.1                                        |
| Build and tests                    | Vite 8.3.0; Vitest 5.0.1; Node types 26.6.2                                                             |
| UI and validation                  | Lucide 1.47.0; tailwind-merge 3.7.0; Zod 4.6.5                                                          |
| Package manager                    | pnpm 10.34.5, the latest patch in the existing 10.x line; CI and release pins synchronized              |
| Metadata container                 | Official Node 24.21.0 Bookworm slim image, pinned by immutable digest; previous image used Node 24.20.0 |

The stateless MCP SDK remains on its current stable 2.0.0 release. The Python SDK has no third-party runtime dependencies. Package-manager major migration to pnpm 12 is outside this maintenance change.

References: [Better Auth 1.7.5 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.5), [React 19.3 release](https://react.dev/blog/2026/09/09/react-19-3), and [official Node container source](https://github.com/nodejs/docker-node/tree/93a7bafc324a85ac1ee461604cff87cffacb6d7a/24/bookworm-slim). Versions and image digest were verified directly against the npm and Docker registries.

## Verification

- Frozen-lockfile installation with pnpm 10.34.5.
- Dependency audit: zero known vulnerabilities; recursive outdated report empty.
- Workspace unit tests: 210 passing, including 169 web tests; seven Python SDK tests pass separately.
- Every workspace build and TypeScript check passes.

- Full disposable Worker integration passes, including 38 security-boundary checks, OAuth/MCP, resumable uploads, recovery/backup, sync, both SDKs, previews, CIMD, and queue indexing.
- All 15 authenticated app routes pass desktop and mobile browser checks with no overflow, error alerts, or browser errors. Token creation, custom permission selection, seven-day expiry, advanced controls, and action-menu revocation were exercised and checked against the local database.

CI and production deployment verification are recorded in the pull request before merge/release. No schema migration or new external service is required. Public npm package versions are unchanged; this change does not publish a new SDK/CLI release.
