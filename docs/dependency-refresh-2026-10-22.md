# Dependency refresh — October 22, 2026

This report covers dependency manifests, lockfile resolution, workflow tool pins, the CIMD container image, and the Python build backend. Application, frontend, SDK, CLI, and infrastructure behavior changes are tracked by their respective implementation owners. No commit, deployment, or publication was performed.

## Direct npm dependencies

Registry query: 2026-10-22T13:58:09.698Z. Queried all 43 distinct direct npm dependencies across eight workspace manifests. Updated 15 distinct direct packages; every direct dependency now targets its registry `latest` stable version. Existing caret/exact policies are preserved. Workspace links and published SDK/CLI versions remain unchanged.

| Package / npm registry evidence | Before | After | Manifest(s) |
| --- | --- | --- | --- |
| [@better-auth/cimd](https://registry.npmjs.org/%40better-auth%2Fcimd) | `1.7.12` | `1.7.12` | `apps/cimd-egress/package.json`, `apps/web/package.json` |
| [@better-auth/drizzle-adapter](https://registry.npmjs.org/%40better-auth%2Fdrizzle-adapter) | `^1.7.12` | `^1.7.12` | `apps/web/package.json` |
| [@better-auth/mcp](https://registry.npmjs.org/%40better-auth%2Fmcp) | `^1.7.12` | `^1.7.12` | `apps/web/package.json` |
| [@cloudflare/containers](https://registry.npmjs.org/%40cloudflare%2Fcontainers) | `0.3.7` | `0.3.7` | `apps/cimd-egress/package.json` |
| [@cloudflare/vite-plugin](https://registry.npmjs.org/%40cloudflare%2Fvite-plugin) | `1.62.1` | `1.64.0` | `apps/web/package.json` |
| [@cloudflare/workers-types](https://registry.npmjs.org/%40cloudflare%2Fworkers-types) | `5.20260926.1` | `5.20261022.1` | `apps/cimd-egress/package.json`, `apps/preview/package.json` |
| [@fontsource-variable/manrope](https://registry.npmjs.org/%40fontsource-variable%2Fmanrope) | `^5.3.0` | `^5.3.0` | `apps/web/package.json` |
| [@fontsource/jetbrains-mono](https://registry.npmjs.org/%40fontsource%2Fjetbrains-mono) | `^5.3.0` | `^5.3.0` | `apps/web/package.json` |
| [@modelcontextprotocol/client](https://registry.npmjs.org/%40modelcontextprotocol%2Fclient) | `^2.3.1` | `^2.3.1` | `apps/web/package.json` |
| [@modelcontextprotocol/server](https://registry.npmjs.org/%40modelcontextprotocol%2Fserver) | `^2.3.1` | `^2.3.1` | `apps/web/package.json` |
| [@radix-ui/react-dropdown-menu](https://registry.npmjs.org/%40radix-ui%2Freact-dropdown-menu) | `^2.1.24` | `^2.2.1` | `apps/web/package.json` |
| [@radix-ui/react-select](https://registry.npmjs.org/%40radix-ui%2Freact-select) | `^2.4.1` | `^2.4.1` | `apps/web/package.json` |
| [@radix-ui/react-slot](https://registry.npmjs.org/%40radix-ui%2Freact-slot) | `^1.3.3` | `^1.5.0` | `apps/web/package.json` |
| [@tailwindcss/vite](https://registry.npmjs.org/%40tailwindcss%2Fvite) | `^4.3.3` | `^4.3.3` | `apps/web/package.json` |
| [@tanstack/react-router](https://registry.npmjs.org/%40tanstack%2Freact-router) | `^1.170.45` | `^1.170.45` | `apps/web/package.json` |
| [@tanstack/react-router-devtools](https://registry.npmjs.org/%40tanstack%2Freact-router-devtools) | `^1.167.2` | `^1.167.2` | `apps/web/package.json` |
| [@tanstack/react-start](https://registry.npmjs.org/%40tanstack%2Freact-start) | `^1.169.3` | `^1.169.3` | `apps/web/package.json` |
| [@types/mime-types](https://registry.npmjs.org/%40types%2Fmime-types) | `^3.0.1` | `^3.0.1` | `packages/cli/package.json` |
| [@types/node](https://registry.npmjs.org/%40types%2Fnode) | `^26.6.5` | `^26.6.5` | `package.json` |
| [@types/react](https://registry.npmjs.org/%40types%2Freact) | `^19.3.0` | `^19.3.0` | `apps/web/package.json` |
| [@types/react-dom](https://registry.npmjs.org/%40types%2Freact-dom) | `^19.3.0` | `^19.3.0` | `apps/web/package.json` |
| [@vitejs/plugin-react](https://registry.npmjs.org/%40vitejs%2Fplugin-react) | `^6.1.1` | `^6.1.2` | `apps/web/package.json` |
| [better-auth](https://registry.npmjs.org/better-auth) | `^1.7.12` | `^1.7.12` | `apps/web/package.json` |
| [class-variance-authority](https://registry.npmjs.org/class-variance-authority) | `^0.7.1` | `^0.7.1` | `apps/web/package.json` |
| [clsx](https://registry.npmjs.org/clsx) | `^2.1.1` | `^2.1.1` | `apps/web/package.json` |
| [commander](https://registry.npmjs.org/commander) | `^15.0.0` | `^15.0.0` | `packages/cli/package.json` |
| [drizzle-kit](https://registry.npmjs.org/drizzle-kit) | `^0.31.10` | `^0.31.11` | `packages/db/package.json` |
| [drizzle-orm](https://registry.npmjs.org/drizzle-orm) | `^0.45.2` | `^0.45.4` | `apps/web/package.json`, `packages/db/package.json` |
| [esbuild](https://registry.npmjs.org/esbuild) | `^0.28.2` | `^0.28.2` | `apps/cimd-egress/package.json` |
| [lucide-react](https://registry.npmjs.org/lucide-react) | `^1.56.0` | `^1.61.0` | `apps/web/package.json` |
| [mime-types](https://registry.npmjs.org/mime-types) | `^3.0.2` | `^3.0.2` | `packages/cli/package.json` |
| [react](https://registry.npmjs.org/react) | `^19.3.0` | `^19.3.1` | `apps/web/package.json` |
| [react-dom](https://registry.npmjs.org/react-dom) | `^19.3.0` | `^19.3.1` | `apps/web/package.json` |
| [react-icons](https://registry.npmjs.org/react-icons) | `^5.7.0` | `^5.7.0` | `apps/web/package.json` |
| [tailwind-merge](https://registry.npmjs.org/tailwind-merge) | `^3.7.0` | `^3.7.0` | `apps/web/package.json` |
| [tailwindcss](https://registry.npmjs.org/tailwindcss) | `^4.3.3` | `^4.3.3` | `apps/web/package.json` |
| [tsup](https://registry.npmjs.org/tsup) | `^8.5.1` | `^9.0.0` | `packages/cli/package.json` |
| [tw-animate-css](https://registry.npmjs.org/tw-animate-css) | `^1.4.0` | `^1.4.0` | `apps/web/package.json` |
| [typescript](https://registry.npmjs.org/typescript) | `^7.0.2` | `^7.0.2` | `package.json`, `apps/cimd-egress/package.json`, `apps/preview/package.json`, `apps/web/package.json`, `packages/cli/package.json`, `packages/sdk/package.json` |
| [vite](https://registry.npmjs.org/vite) | `^8.3.4` | `^8.3.5` | `apps/web/package.json` |
| [vitest](https://registry.npmjs.org/vitest) | `^5.0.1` | `^5.0.5` | `package.json`, `apps/web/package.json`, `packages/sdk/package.json` |
| [wrangler](https://registry.npmjs.org/wrangler) | `4.151.1` | `4.151.3` | `apps/cimd-egress/package.json`, `apps/preview/package.json`, `apps/web/package.json` |
| [zod](https://registry.npmjs.org/zod) | `^4.6.5` | `^4.6.7` | `apps/web/package.json`, `packages/cli/package.json`, `packages/contracts/package.json` |

## Package manager and build compatibility

- **pnpm:** `10.34.5` → `10.34.7` in `package.json` and both workflows. This is the registry's current `latest-10`; `latest` is `12.15.0`. The [10.34.6 security fixes](https://github.com/pnpm/pnpm/releases/tag/v10.34.6) included trusted configuration for package-manager self-updates, current release/signing keys, and a patched embedded ZIP dependency. [10.34.7](https://github.com/pnpm/pnpm/releases/tag/v10.34.7) also fixes signature verification with registry mirrors. The existing version-9 lockfile and approved build-script list remain compatible.
- **Intentionally deferred pnpm major migration:** pnpm 11 removes `onlyBuiltDependencies` in favor of `allowBuilds`, defaults to a release-age policy and stricter script handling, changes the store/configuration layout, and changes publish/audit command implementations. pnpm 12 additionally validates workspace settings strictly and changes dependency resolution. These need a dedicated installation/publishing migration across developer environments and CI; this pass takes the maintained 10.x security patch. See the [11.x migration](https://pnpm.io/11.x/migration) and [12.0.0 release](https://github.com/pnpm/pnpm/releases/tag/v12.0.0).
- **tsup:** accepted the `8.5.1` → `9.0.0` major. The [release](https://github.com/egoist/tsup/releases/tag/v9.0.0) raises build-time Node requirements and updates its watcher/bundler dependencies; the repository's ESM configuration works unchanged. The private workspace now declares `node: "^22.18.0 || ^24.11.0 || >=26.0.0"`, matching tsup's supported build runtimes. Developers on older Node 22/24 patches must update Node before building. Published CLI (`>=22.12.0`) and SDK (`>=22`) runtime requirements are unchanged; tsup is a development dependency, and the emitted CLI still targets ES2022.
- **npm publisher:** `12.0.2` → `12.2.1` in the release workflow. Its [registry metadata](https://registry.npmjs.org/npm/12.2.1) requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`; the workflow's Node 24 setup resolves a compatible current patch. OIDC publishing remains the existing publication mechanism.
- **Stable release selection:** Drizzle 1.0 RC, Better Auth 1.8 beta, React Icons 6 beta, Cloudflare Vite plugin 2 beta, and TypeScript 7.1 prereleases were not selected. All 43 direct npm packages match their stable `latest` tags. Cloudflare's own required Miniflare prerelease transitive versions remain as specified upstream.

## Security and lockfile result

The initial all-dependency audit found **two moderate advisories**, both in `@vitest/mocker@5.0.1`:

- [GHSA-qxg6-89mg-rqv8](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8): code injection through manual mock registration on the development server.
- [GHSA-xp26-3454-mjgp](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp): Windows traversal bypass in redirect mock handling.

Both are patched from 5.0.3. Updating Vitest to 5.0.5 resolves `@vitest/mocker` to 5.0.5. The refreshed **all-dependency and production-only audits report zero known vulnerabilities**. No advisory exclusions or new blanket overrides were added. This is an npm advisory audit, not an OS-image or Python vulnerability scan.

The existing targeted `pnpm-workspace.yaml` overrides remain unchanged:

| Override selector | Resolution | Reason retained |
| --- | --- | --- |
| `esbuild@<0.28.1` | `^0.28.2` | Existing security floor, including older upstream tool constraints; 0.28.2 is still current stable. |
| `sharp@<0.35.5` | `0.35.5` | Existing security floor; 0.35.5 is still current stable. |
| `source-map-js@<1.2.2` | `^1.2.2` | Existing security floor; 1.2.2 is still current stable. |

Only `esbuild`, `sharp`, and `workerd` may run dependency build scripts, as before. `pnpm-workspace.yaml` did not require a change.

Selected lockfile changes:

| Package | Before | After |
| --- | --- | --- |
| `@vitest/mocker` | 5.0.1 | 5.0.5 |
| `workerd` | 1.20260926.1, 1.20261012.1 | 1.20261012.1, 1.20261019.1 |
| `miniflare` | 5.20260926.1-alpha, 5.20261012.1-beta | 5.20261012.0-beta, 5.20261019.1-beta |
| `rollup` | 4.63.4 | 4.65.0 |
| `chokidar` | 4.0.3, 5.0.0 | 5.0.0 |

The lockfile contains 455 package entries, down from 476. The npm audit reports 464 dependency occurrences after peer resolution, down from 485; these counts use different units. No application performance claim is inferred from these counts.

The install still reports deprecated upstream `@esbuild-kit/core-utils@3.3.2` and `@esbuild-kit/esm-loader@2.6.5`, pulled in by stable Drizzle tooling. They have no reported findings in this audit. Replacing their loader with an unrelated package through an override would be an API migration; retain them until Drizzle's stable release removes them.

## Workflow tool pins

Every action remains pinned to an immutable 40-character commit, with a human-readable release comment. Commit identities were checked against official GitHub tag-reference APIs; both workflows parse successfully as YAML, and their pnpm inputs match `packageManager`.

| Action | Before release / commit | After release / commit |
| --- | --- | --- |
| [actions/checkout](https://api.github.com/repos/actions/checkout/git/ref/tags/v7.0.1) | v4.4.0 / `11d5960a326750d5838078e36cf38b85af677262` | v7.0.1 / `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| [pnpm/action-setup](https://api.github.com/repos/pnpm/action-setup/git/ref/tags/v6.1.0) | v4.3.0 / `b906affcce14559ad1aafd4ab0e942779e9f58b1` | v6.1.0 / `ea17c68df8912ef543352723c149a84f56e3d413` |
| [actions/setup-node](https://api.github.com/repos/actions/setup-node/git/ref/tags/v7.1.0) | v4.4.0 / `49933ea5288caeca8642d1e84afbd3f7d6820020` | v7.1.0 / `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| [actions/setup-python](https://api.github.com/repos/actions/setup-python/git/ref/tags/v7.1.0) | v5.6.0 / `a26af69be951a213d495a4c3e4e4022e16d87065` | v7.1.0 / `6d4fd22b20465ccc0f7354476588e8df7c9ca0e0` |

Compatibility review:

- The updated actions execute on Node 24 and require Actions runner 2.327.1 or newer. The existing GitHub-hosted `ubuntu-latest` runners meet this requirement.
- [Checkout v7](https://github.com/actions/checkout/blob/v7.0.1/README.md) changes unsafe fork-checkout behavior for `pull_request_target` and `workflow_run`; these workflows use neither trigger.
- [Setup-node v7](https://github.com/actions/setup-node/blob/v7.1.0/README.md) removes a dummy `NODE_AUTH_TOKEN` fallback. Its official guidance confirms npm OIDC publishing is unaffected. The release script already uses `npm publish --provenance`, and `cache: pnpm` remains explicit. GitHub execution is still required to verify the hosted OIDC flow.
- [Setup-python v7](https://github.com/actions/setup-python/releases/tag/v7.0.0) removes `pip-install`; this project never used it. CI retains the Python 3.12 release line.
- [pnpm/action-setup v6.1.0](https://github.com/pnpm/action-setup/blob/v6.1.0/README.md) supports the selected pnpm 10 pin.

## CIMD container and Python backend

The CIMD image changes from official **Node 24.21.0 Bookworm slim** to **Node 24.22.1 Bookworm slim**, preserving the runtime major and Debian variant:

- Before: `docker.io/library/node@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`
- After: `docker.io/library/node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`

The new multi-platform digest was checked against the [official Docker tag API](https://hub.docker.com/v2/repositories/library/node/tags/24.22.1-bookworm-slim/) and registry manifest. The [Node release index](https://nodejs.org/dist/index.json) identifies the current Node 24 patch. Node 24 remains supported LTS; Node 26 is still Current on the review date, with LTS scheduled for October 28 in the [official schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json). The existing `build.mjs` target of `node24` remains correct. No container runtime test was possible: Docker reports that `/var/run/docker.sock` does not exist.

Python's build-system requirement changes from `setuptools>=77` to **`setuptools>=84.2.1`**, raising the build-backend floor to the current stable release. [PyPI release metadata](https://pypi.org/pypi/setuptools/84.2.1/json) declares Python `>=3.10`, matching the SDK. The SDK has no third-party runtime dependencies. Setuptools' removed legacy APIs are not used by this simple `setuptools.build_meta` project; see the [official release history](https://setuptools.pypa.io/en/stable/history.html). An isolated wheel build succeeded, and its metadata still specifies Python `>=3.10` with no `Requires-Dist` entries.

## Checks and remaining verification

Local verification used Node 26.11.1 and Python 3.14.8. Since pnpm is not on the environment's base PATH, pnpm commands were invoked as `npm exec --yes --package=pnpm@10.34.7 -- pnpm …`; the baseline used the previous 10.34.5 pin.

| Check | Result |
| --- | --- |
| Baseline `pnpm test` | Passed: 253 tests, including 207 web tests. |
| Updated install | Passed without peer-dependency warnings; only the two deprecated Drizzle subdependencies noted above. |
| `pnpm install --frozen-lockfile` | Passed; lockfile up to date, no resolution needed. |
| `pnpm outdated -r --format json` | `{}`; no outdated direct npm dependencies. |
| `pnpm audit --json` | Zero vulnerabilities at all severities (baseline: two moderate). |
| `pnpm audit --prod --audit-level low` | No known vulnerabilities. |
| Updated `pnpm test` | Passed: 253 tests at the time of the dependency check. |
| `pnpm check` | All workspace typechecks passed at the time of the dependency check. |
| tsup 9 targeted CLI build | Passed using the existing config and a temporary output directory; emitted CLI `--version` and `--help` passed. Temporary output needed a link to the CLI's installed dependencies, since the config intentionally leaves runtime dependencies external. |
| Python wheel build | `pip wheel --no-deps` passed from a temporary source copy with isolated PEP 517 build dependency installation; repository build outputs were not modified. |
| Python SDK tests | Seven tests passed. |
| Workflow YAML, action hashes, pnpm consistency | Parsed and verified against official release tag references. |
| Container digest | Matches official Node 24.22.1 Bookworm slim tag; Docker daemon unavailable for execution. |

Other agents were editing application source concurrently. These checks validate the dependency update at their recorded execution point; the parent must run the final combined full build/integration checks after those changes settle. No full application build, production deployment, hosted GitHub workflow, container execution, or npm publication was run by this dependency task. No application source migration was required by the versions selected here.

Subsequent combined build, integration, browser, and security results are recorded in [the maintenance report](maintenance-2026-10-22.md). The parent also updated the standalone cleanup smoke script's pnpm pin to 10.34.7.

## Follow-up during the fifty-feature expansion

The later outdated check found stable **Wrangler 4.152.0**, after the original inventory selected 4.151.3. The three existing exact pins in `apps/web`, `apps/preview`, and `apps/cimd-egress` now use 4.152.0. The lockfile was regenerated with pnpm 10.34.7; no application dependency was added.

The [npm release metadata](https://registry.npmjs.org/wrangler/4.152.0) identifies the Cloudflare workers-sdk repository and GitHub Actions publisher, retains Node `>=22.0.0` and workerd `1.20261019.1`, and advances its Miniflare dependency from `5.20261019.1-beta` to `5.20261019.2-beta`. The registry's `latest` tag resolves to 4.152.0. The corresponding GitHub release URL returned 404 during this check, so no release-note claim is inferred from it. Installation succeeded without peer-dependency warnings.

The earlier tables record first-phase checks at their execution time. Final checks on this newer Wrangler version are recorded in the [performance expansion report](performance-expansion-2026-10-22.md).
