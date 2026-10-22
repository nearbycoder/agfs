# 50-feature release preflight — 2026-10-22

**ROOT PHASE 1 RELEASEGO — final evidence, remote migration, feature push and PR authorized; merge/activation PENDING required CI.** Baseline: `9663bb0b0f778a933dc02028bf0ca3ddd27322a0`. Scope remains exactly 50 features: browser #71–87, server #88–104, clients #105–120. Operations UI integration, tests and resource corrections add no features.

The user has already authorized the release. **ROOT PHASE 1 RELEASEGO is received** for the finalized evidence commit, migration, push and PR; merge/activation remain the next coordinated step after required CI. The initial preflight changed only this new report and disposable sanitized evidence. The later authorized packaging reconciliation also updates the consolidated feature guide and cloud-cost report; implementation reports remain owned by their authors. Those earlier preflight passes ran no application tests, benchmarks, builds, dev servers, dependency installation, nested agents, Git mutations or production writes. Local implementation commit `779cb4fc8c3976e99b2479711fecdd3eed8c6c4b` contains 107 reviewed paths. Root has now authorized the final evidence commit, remote 0018 migration, feature push and PR after all local gates passed. Merge and activation remain a later coordinated step after required CI. Existing cached GitHub/Cloudflare authentication was used normally; raw credentials, private payloads, environment values, headers and cookies were not retained in the evidence.

## Current validation gate

The user has explicitly asked to deploy. **ROOT PHASE 1 RELEASEGO is received; no further user confirmation is needed.** Latest coordinator evidence supersedes older status paragraphs in owner reports:

- Browser/Operations and client R3 were clear. Copy-only SDK R4 and expected-TERM143 runner R5 are now independently **CLEAR**, with no actionable findings: [review](/home/nearby/.t3/userdata/tmp/agfs-copy-r4-term-r5-review-dprfdrs4/review.txt). Ordinary download/upload-part behavior is unchanged. SDK author evidence is 181 tests, 56 retained independent TypeScript checks and typecheck; do not add these to historical workspace totals.
- The server author has frozen the final explicit-parent-alias/unique-ID-index correction: helper SHA-256 **`dd6281d9c0a41449956e09040b32bedc8f1207925b3f84d967be6fd6f8ce235d`**. Coordinator-reported author evidence is **86 focused tests and 72 targeted benchmark cases passed**, plus **four separately documented inherited foreign-key observations**. The explicit fix matches its control; API/contracts/migration are unchanged. Fresh narrow **server R6 is CLEAR**: [independent review](/tmp/agfs-independent-server-r6-20261022/review.json), 64 passing focused checks, all 38 freeze hashes and the four-file delta verified. Exact unique-ID access matches its control; unchanged prior findings retain clearance. The inherited FK cascade was confirmed in baseline with no additional invocations or correctness change.
- Current cleanup accounting is at most **157 SQL statements / 64 trips**, measured full turn **137 / 44**, with **1,830 changes** and unchanged parent/child/R2/queue caps. The inherited SQLite FK cascade can still scan `upload_parts` under one-row stale child statistics; its attribution is separate. No schema expansion, universal SQLite-VM bound or Worker-CPU guarantee is claimed.
- Actual integration attempt 1 passed **715 existing explicit checks**, additional unnumbered workflows, **21 new Operations cases / 150 requests**, and two client cases before the copy failure. Preserve that failed run. After the cleared copy fix, focused real runtime passed **all 15 SDK/CLI + eight Python workflows**; Python made 13 requests. The client summary has 16 records because it includes the Python invocation wrapper, not an extra workflow.
- SDK/CLI rebuilds at **21:41:31–21:41:33 UTC** passed. Complete 518-artifact manifest SHA-256 is **`83ca2533b62dcf4525918fda4324206b8c863bfd0d43627aecde07a1dd044288`**. Only SDK `dist/automation.js` changed; CLI rebuilt identically and all 497 web files plus preview/CIMD artifacts stayed unchanged. This is the historical SDK/CLI refresh; the final web build below supersedes its complete manifest.
- Per the coordinator's latest update, **all 17 browser examples/downloads and all 17 Operations live workflows are complete**, including actual JSON/CSV save, MIME/readback and conflict evidence. The P3 mobile button overflow is fixed in source (`OperationsBudgets.tsx` SHA-256 `4f382ca7d46b00035bfb8162e7772aa201c818ea8f7096242bcdacdf09c581e6`); the final built visual retest and desktop/mobile narrow smoke passed, clearing P3. Browser evidence is attributed to its owner/coordinator, not rerun here.
- All local release gates are complete: server R6, final web build, combined runtime, final built browser recheck and owned fixture closure. Phase 1 is authorized: evidence commit → remote 0018 → first feature push → PR. Required hosted `verify`, merge, actual activation and production checks remain pending.

The focused runtime evidence is [clients-runtime-result.json](/home/nearby/.t3/userdata/tmp/agfs-sdk-cli-refresh-x4a5yl09/clients-runtime-result.json) and [focused-runtime-verification.json](/home/nearby/.t3/userdata/tmp/agfs-sdk-cli-refresh-x4a5yl09/focused-runtime-verification.json). The historical integration report SHA-256 at the earlier handoff was `321176e3070ebbcad927939d73c93c7fbe226624cbd3b2e9e526dd8111da724d`; its eleven-file inventory SHA-256 is `6ccaec6505d081abbd647f80318c817837f24cf02c46600ca9121d95f35cfeb5`. Nine integration code files remain identical to the cleared TERM143 review; the subsequently frozen Queue script correction is described below. The report was deferred from the first local commit. Its final handoff is now complete, SHA-256 `749bc9d78f51c58acd6794b301307d1d018320fc7dc68be8655de48c60f4f7d0`; all ten scripts are frozen. The earlier source-recovery incident and historical validation below are preserved, not promoted to final-release evidence.

## Local implementation commit handoff

The local implementation commit is **`779cb4fc8c3976e99b2479711fecdd3eed8c6c4b`** on `feature/50-workflows-2026-10-22`, with **107 explicit paths**. The complete phase allowlist contains 108 paths. The final five-document follow-up includes the integration report, finalized browser report and three coordinator documents. The two generated `.pyc` files stay excluded. No amend, force push or discarding another owner's changes is needed.

At **21:58:52 UTC**, local main/HEAD still matched baseline, the target local branch was unused and nothing was staged. All38 final server files matched `/tmp/agfs-server-r5-settled-inventory-20261022.json`, manifest SHA256 `3d47de8f739dc2d32db0c0012fa57af1de3cd591a7b838b0c09853fdf74bf848`; all 25 client files and20 UI production files matched their final manifests. All518 final emitted files matched [built-artifacts-final.json](/home/nearby/.t3/userdata/tmp/agfs-final-integration-o3s4cls1/built-artifacts-final.json), SHA256 **`3cbb1690bea1e332987c947e5003132ae16e3414035d2951aa3f8f5d9a8f986f`**. Selected candidate files are regular files; bounded private-key/provider-token pattern checks found no candidates and no credential/config/log/archive path enters the allowlist. This is not an exhaustive secret-detection guarantee.

Final web build **21:52:38–21:52:46 UTC passed**, with no source drift and 21 unchanged non-web artifacts. CSS SHA256 is `64347b350bb7ba87e5c1640de1f81c0b1b637670691db980fa2f29805319b417`; Worker entry SHA256 is `7489535147b61eec3b950c7fcc61b7abadb5629c72464a4ff6889623ec3885c7`. The helper and mobile-label source hashes above are included. Historical full-workspace totals are still attributed to their earlier checkpoint.

On this final build, full attempt1 passed **715 existing explicit checks plus unnumbered workflows,21 Operations/150 requests,15 SDK/CLI,eight Python and the existing Queue lifecycle**. The first new Queue case then failed a harness Origin mismatch (`8790` versus configured application Origin `8787`), before any of the three new Queue cases passed. This is a test-harness mismatch, not a production defect. Exit1 is retained; all guardians acknowledged closure,55 observed PIDs were absent and eight ports closed. The frozen Queue-only correction uses configured Origin8787 and explicitly asserts Origin8790 returns403; SHA256 `24e2707617bda988dc950800cca845db20ab4a4cf86c921837a258cb3a49b2f5`. No lifecycle/helper/production change or rebuild accompanies it. Final combined attempt 2 subsequently passed, as recorded below; the earlier failed attempt remains a failure.

Completed browser evidence is [browser validation](feature-expansion-browser-validation-2026-10-22.md): all 17 tools and17 Operations live workflows. The final built mobile-label visual recheck and narrow desktop/mobile smoke passed; no wholesale workflow rerun was needed. Physical-device testing and production CPU/memory/billing remain unmeasured.

### Final combined runtime and browser closure — PASS

The final combined run started **21:57:26.182 UTC** and completed all suites by **21:59:41.629 UTC**: **60 lifecycle checks separately**, **715 existing explicit checks plus unnumbered workflows**, **21 Operations / 150 requests**, **15 SDK/CLI**, **eight Python / 13 requests**, and **three actual Queue cases**. The Python wrapper is excluded from workflow counts. All 518 artifact files and all 38 final server hashes matched. No enabled external hooks existed.

Three scheduled cleanup turns retired 75 old metrics and 65 expired snapshot children while preserving the active pin, live entry, recent metrics and exact 29-byte R2 body. The other Queue cases verified read-only/no-dispatch versus reviewed apply and metadata/paused failure retry. These are actual local D1/R2/Queues results, not production CPU or billing measurements.

The final browser recheck cleared P3 at 390 px with normal and 95-character labels: the 128 px visible label fits the 188 px button and 222 px card, full accessible identity remains, and removal invalidates review and clears drafts. Desktop CSV (74 bytes, BOM) and mobile JSON (103 bytes) downloads matched their binary hashes with zero transformation API calls. Desktop/mobile Operations reads passed with one identity check each. All 497 web files remained unchanged; owned tabs closed. See [final browser evidence](/home/nearby/.t3/userdata/tmp/agfs-final-browser-recheck-p588Hb/results.json).

At **22:04:13 UTC**, the integration owner closed the intentionally retained fixture through its owned PTY. Actual owner exit **130 / requested SIGINT** is preserved; this is not a failed application suite or an invented exit 0. Seventeen finite commands exited 0; four Wrangler commands exited 143 with their own successful pinned-identity SIGTERM records. All 21 guardians acknowledged children reaped and closed with null errors; shutdown succeeded, no failure file existed, all 59 recorded processes were absent and eight ports closed. All 518 artifacts, 38 server and 506 source hashes/file sets remained unchanged through closure. Both owner reports are finalized.

Evidence: [combined result](/home/nearby/.t3/userdata/tmp/agfs-final-integration-o3s4cls1/final-attempt-2-result.json), [closure ledger](/home/nearby/.t3/userdata/tmp/agfs-final-integration-o3s4cls1/final-fixture-closure.json), and [integration report](feature-expansion-integration-2026-10-22.md). Immutable suite-boundary log SHA-256 is `b8cf17bbe0552c8b18e20feda2c932347c3c075dbf044da79349e7348c544df1`; complete log SHA-256 is `4cec8ca06309eb4914504dc5fe2e5ca93eb6ec7259c325afa9b89377c041ab2a`. Historical failed runs and resource limits remain preserved.

Local commit evidence/107-path selection: [verification](/tmp/agfs-local-commit-20261022-hc9ic4zg/verification-before-docs.json), [implementation paths](/tmp/agfs-local-commit-20261022-hc9ic4zg/implementation-paths.txt). Prepared [remote commands](/tmp/agfs-local-commit-20261022-hc9ic4zg/remote-release-after-go.sh) and [PR body](/home/nearby/.t3/userdata/tmp/agfs-release-final-20261022-r77mvaoz/pr-body.md) remain gated on RELEASEGO. Existing migration-before-first-push and `--keep-vars` requirements are unchanged.

Read together: [feature guide](feature-expansion-2026-10-22.md), [browser implementation](feature-expansion-browser-2026-10-22.md), [Operations UI](feature-expansion-operations-ui-2026-10-22.md), [server implementation](feature-expansion-server-2026-10-22.md), [client implementation](feature-expansion-clients-2026-10-22.md), [cloud cost audit](feature-expansion-cloud-cost-2026-10-22.md), [integration report](feature-expansion-integration-2026-10-22.md), [styled browser plan](feature-expansion-browser-validation-2026-10-22.md), and [prior deployment record](deployment-2026-10-22.md). The prior deployment record's web version is historical; the active version observed below is newer.

## Local source and artifact observations

At **20:50:19 UTC**, HEAD and branch were baseline/main, with **30 modified tracked files, 79 untracked files, zero staged files**. The ownership reconciliation at **20:53:28 UTC** found 38 server, 25 client, 30 browser/Operations, 11 integration, and three coordinator-document paths: **107 intended release paths** before this report, plus two excluded generated files:

```text
apps/web/src/lib/__pycache__/server-feature-expansion-cleanup.bench.cpython-314.pyc
apps/web/src/lib/__pycache__/server-feature-expansion.bench.cpython-314.pyc
```

These bytecode files remain untouched and must not be staged. There were no deleted tracked files or unexpected ownership paths. No `.env`, raw credential file, recovery source archive, `source.tar`, log or temporary artifact appeared in the candidate path inventory. This is a path/staging check, not a claim of an exhaustive content secret scan. Existing unrelated worktrees were only listed; none was entered or changed. No applicable `AGENTS.md` was found in workspace ancestors or the repository search.

All **11 package/Python manifest, lockfile and workspace-manifest files**, both GitHub workflows, and all three Wrangler configurations match the baseline byte-for-byte. Preview/CIMD source has no change in the status inventory. The source-recovery incident's archives remain outside the proposed commit. Use an explicit reviewed path allowlist; do not stage the whole checkout indiscriminately.

At **20:52:15 UTC**, the then-current 38 server files, 25 client files and 20 browser/Operations production files matched their owner manifests. All **518 built artifacts** matched the integration manifest captured at **20:47:13 UTC**, SHA-256 `bc306bcc84b2bd404ebdc33965d3bd38366de48f6a357dbd766887f9763f3a6b`. The historical server inventory SHA-256 was `a9729425c6d44d132740cabb1d53924e34d1e6a365b06ee2d81c5ba004856eb7`. **These are observations before the newly requested cleanup correction, not final source/build clearance.** Copies of both observed manifests are preserved in this preflight's evidence directory.

The integration owner's standard-validation metadata records:

| Command | Earlier checkpoint result |
| --- | --- |
| `pnpm audit --audit-level low` | Exit 0, no known vulnerabilities; 20:44:48–20:44:49 UTC |
| `pnpm test` | Exit 0; **1,014 workspace tests**: web 755, SDK 169, CLI 71, CIMD 7, preview 5, DB 5, contracts 2 |
| `node scripts/feature-expansion-preflight.mjs` | Exit 0 before the build; output-symlink inspection |
| `pnpm build` | Exit 0; 20:44:57–20:45:04 UTC; existing nonfatal `css-post` sourcemap warning |
| `pnpm check` | Exit 0; 20:45:04–20:45:06 UTC |
| Python unittest discovery | Exit 0; **44 tests**; 20:45:06–20:45:07 UTC |
| `node scripts/integration.mjs` | Not run at the historical 20:45 checkpoint; later partial, focused and final passing combined runtime evidence is recorded above |

Counts were extracted from existing owner logs without rerunning commands. The 1,007 Vitest tests span 108 files; CIMD contributes seven Node tests. Between the historical before/after-build source manifests, only `scripts/feature-expansion-fixtures.mjs` and `scripts/feature-expansion-process-guardian.py` changed. The later server correction has the final R6/build/runtime provenance above. The author's earlier 352 focused server tests and 45 resource/24 cleanup benchmark cases also predate that correction; they are not additional workspace-test totals or measured production CPU/billing.

## GitHub readiness and required CI

Bounded read-only GitHub metadata began at **20:50:06 UTC**. Authenticated identity is `nearbycoder`; repository push/maintain/admin permissions are present. The OAuth scope list includes `repo`, but not `workflow`. Both workflows are unchanged, so this phase does not require a workflow-file push. Existing origin remains `https://github.com/nearbycoder/agfs`. A read-only SSH `ls-remote` succeeded using `git@github.com:nearbycoder/agfs`; use that explicit push URL without changing global or repository remotes.

Remote `main` equals `9663bb0b0f778a933dc02028bf0ca3ddd27322a0`. Proposed branch **`feature/50-workflows-2026-10-22`** was absent remotely (GitHub 404 and no SSH ref) and locally. Recheck immediately before creation/push.

Current protection: required status context **`verify`**, **strict/up-to-date branch required**, **administrators enforced**, conversation resolution required, no required approval rule, no extra active branch rules returned. Force pushes and deletion are disabled. Merge commits are allowed; repository auto-merge is disabled. Do not use an admin bypass or force push.

The actual [CI workflow](../.github/workflows/ci.yml) runs on pull requests and pushes to main. Job `verify` uses Ubuntu, Node 24, Python 3.12, pnpm 10.34.7 and a 20-minute timeout, in this order:

```sh
pnpm install --frozen-lockfile
pnpm audit --audit-level low
pnpm test
pnpm build
pnpm check
PYTHONPATH=packages/python-sdk python -m unittest discover -s packages/python-sdk/tests
node scripts/integration.mjs
```

The installed shared dependencies were already recovered by their owner; this preflight did not reinstall them. Fresh CI uses its frozen install. Baseline `verify` and `Workers Builds: agfs-dev-production` checks succeeded on October 22, but **do not satisfy the future feature-head check**. The latter is not the required protection context; its successful baseline build is evidence of an existing Cloudflare Git connection, not proof of current branch activation commands.

The separate [publish workflow](../.github/workflows/release.yml) runs on manual dispatch or a published GitHub Release. Do not dispatch it or create a published release for this rollout. SDK/CLI/Python/contracts changes ship as repository source; **no npm/PyPI publication is authorized**.

## Observed production baseline

Normal noninteractive installed-Wrangler `whoami` succeeded at **20:50:29 UTC** and recognized account `0a4ba75d9277c4e96b49255f3109e7b6`. Deployment/settings/migration reads returned HTTP 200 at **20:51:02–20:51:04 UTC**. No login, new credential, new scope, GraphQL usage query or Builds API retry was attempted.

| Resource | Actual observed active version / state |
| --- | --- |
| `agfs-dev-production` | **`3608285c-bca5-4f8d-8c65-4930c00efb2d`**, 100%; deployment `fad4a56b-560b-4316-8edb-bf408687c463`, created 17:03:37.511 UTC |
| `agfs-preview` | **`518e7ada-90f0-42d6-b3ba-86e79fcfc31e`**, 100% |
| `agfs-cimd-egress` | **`7fcc0095-ee4b-4930-a5fb-a03fcf934853`**, 100% |
| D1 `agfs-db` | `e40aac3b-5468-468c-b110-ac6a6ca4cece`; migration ledger contains **0000–0017**, **0018 absent** |
| R2 | Existing `FILES_BUCKET` → `agfs-files` binding |
| Queue/service | Existing `BACKGROUND_QUEUE` → `agfs-background`; `CIMD_EGRESS` → `agfs-cimd-egress` production |
| Schedule | Existing `* * * * *` cron; no trigger change required |

The migration read was only `SELECT name, applied_at FROM d1_migrations ORDER BY id;`. Migrations 0014–0016 were applied at 16:27:50 UTC, 0017 at 16:27:51 UTC. No user tables, payloads, global consistency counts or production benchmarks were queried. The cost report's earlier database-size snapshot is not a new observation from this preflight.

The exact active-version metadata endpoint returned version **163**, created **17:03:35.499 UTC**, at **20:51:40 UTC**. No commit annotation was present, so matching build time/check metadata is corroboration, not an exact commit attestation. Module content was not requested. The source baseline and exact rollback version are preserved.

Observed web binding names/types, without values:

- Plaintext: `APP_URL`, **`GITHUB_CLIENT_ID`**, `PREVIEW_URL`, `R2_BUCKET_NAME`.
- Secret text: `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_SECRET`, **`PAID_PLAN_EMAILS`**, `PREVIEW_SIGNING_SECRET`, `R2_ACCESS_KEY_ID`, `R2_ACCOUNT_ID`, `R2_SECRET_ACCESS_KEY`.
- Resources: `DB`, `FILES_BUCKET`, `BACKGROUND_QUEUE`, `CIMD_EGRESS`; rate limiters `AUTH_RATE_LIMITER`, `OP_RATE_LIMITER`, `SEARCH_RATE_LIMITER`.

Preview settings separately confirmed `FILES_BUCKET` and `PREVIEW_SIGNING_SECRET`. Preserve all names/types and existing values. No new secret is needed. Production uses compatibility date `2026-09-06`, `nodejs_compat` and `global_fetch_strictly_public`; observability is enabled. No CPU/memory/usage/billing totals were collected.

The unchanged production config keeps both queue consumers: main batch 10, timeout 1 second, retries 3, dead-letter queue `agfs-background-dead`; dead-letter batch 10/timeout 1 second. Preserve both consumers, D1/R2 bindings, service binding, rate limiters and cron. This preflight verified the live producer binding and the source consumer configuration, not a separate live queue-consumer settings response. Preview and CIMD need **no redeploy**; unchanged CIMD requires no Docker build. No new route or private/version-preview setting is required for this rollout.

## Packaging refresh — 21:47–21:48 UTC

Bounded read-only refresh confirmed remote main still at baseline, strict `verify`/administrator/conversation protection unchanged, SSH access working and proposed branch still absent. All three active versions remain as listed above at 100%; D1 still has 0000–0017 and no 0018. All 18 web binding names/types remain unchanged. Hosted-build activation commands remain unverified; no further remote exploration is required for this packaging pass.

At 21:48:01 UTC, all 25 client files, all 11 integration files and all 518 emitted files matched the supplied inventories. All16 protected manifest/workflow/config files matched baseline. Migration 0018 remains SHA-256 `fa9977307fa300167862547cd33ed2b4c2b1ba090a492165d9f0b5f182c67e3c`; its additive/backfill contract is unchanged. The server R4 inventory is historical, superseded by the final helper freeze above. There are **108 explicit release paths**, plus the same two excluded `.pyc` files; nothing is staged and no credential/log/archive path appeared in the candidate inventory. Refresh hashes, not staging, while owners finish evidence.

Current preparation files: [allowlist](/tmp/agfs-release-reconcile-20261022-0d9zatj7/release-paths.txt), [PENDING PR body](/home/nearby/.t3/userdata/tmp/agfs-release-final-20261022-r77mvaoz/pr-body.md), [integrity](/tmp/agfs-release-reconcile-20261022-0d9zatj7/integrity-and-allowlist.json), [remote readiness](/tmp/agfs-release-reconcile-20261022-0d9zatj7/remote-readiness.json). These supersede the older temporary allowlist/body for packaging. The candidate path set includes all three authorized reconciliation documents.

## Final release readiness — 22:07 UTC

The bounded pre-write refresh reconfirmed remote main at `9663bb0b0f778a933dc02028bf0ca3ddd27322a0`, strict required `verify`, enforced administrators, required conversation resolution and no approval rule. SSH access succeeded; the remote feature branch is absent. Normal existing Wrangler authentication succeeded. Web version `3608285c-bca5-4f8d-8c65-4930c00efb2d` remains at 100%, all 18 binding names/types match, and **0018 is the only pending migration**. No remote writes occurred during this refresh. Only the existing public plaintext client ID was preserved in a private mode-0600 file outside Git for recovery; no secret values were inspected or published.

Final pre-commit verification matched 38 server, 25 client, 20 UI production and 11 integration files plus all 518 artifact hashes. All 16 manifest/workflow/config files match baseline; the full release allowlist has exactly 108 paths and the final evidence selection five reports. No executable Git hooks or bounded private-key/provider-token pattern candidates were found. See [readiness](/home/nearby/.t3/userdata/tmp/agfs-release-final-20261022-r77mvaoz/remote-before-release.json), [verification](/home/nearby/.t3/userdata/tmp/agfs-release-final-20261022-r77mvaoz/verification-before-evidence-commit.json), and [five-report selection](/home/nearby/.t3/userdata/tmp/agfs-release-final-20261022-r77mvaoz/evidence-paths.txt). This metadata is pre-migration evidence; subsequent execution results belong to the release handoff.

## Variable preservation and hosted-build uncertainty

**Direct deployment must pass `--keep-vars`.** The live `GITHUB_CLIENT_ID` is plaintext and absent from the local production `vars` map. The [web package script](../apps/web/package.json) and [Wrangler config](../apps/web/wrangler.jsonc) do not set `keep_vars`. Installed Wrangler 4.152.0 help explicitly says unlisted plaintext vars are removed without this flag; secrets are preserved by deployment. Do not rely on the bare script to retain this extra plaintext variable or convert any binding type.

The repository [Git-build instructions](../README.md#cloudflare-git-deploys) describe main deployment and feature-branch `wrangler versions upload --env production`. The coordinator reports that the existing connected build preserves production bindings/vars and feature branches upload versions. **Current hosted build commands/branch filters were not independently retrieved here.** Previous Builds API access lacked scope (403); it was not retried. A green GitHub Cloudflare check and deployed-version metadata do not expose those settings.

Therefore early feature push before migration is conditional on confirming upload-only behavior. The conservative sequence below applies 0018 **before any first feature push**, avoiding reliance on branch behavior for schema safety. Root must also retain/confirm the existing binding-preserving hosted command before a push can trigger it; `--keep-vars` is explicit for any direct fallback. Unverified automation settings remain a release prerequisite, not permission to change them in this preflight.

## Rollout sequence — commands prepared, NOT executed

Use the existing pinned pnpm 10.34.7 launcher. Capture potentially sensitive Wrangler output into owned mode-0600 logs and emit only allowlisted status/version/exit-code metadata. `RELEASE_LOG_DIR`, `RELEASE_HEAD_SHA` and `PR_NUMBER` below are operator-selected release variables, not preset values.

1. **ROOT PHASE 1 RELEASEGO received.** All final local source, independent review, artifact, combined runtime, browser and fixture-closure gates are complete. Recheck remote main/protection, absent remote feature branch, migration hash/ledger and pre-release active version before writing. Preserve rollback metadata. Merge and activation remain gated on required hosted CI and root's next step.

2. **Finalize the evidence commit on the existing feature branch.** Implementation commit `779cb4fc8c3976e99b2479711fecdd3eed8c6c4b` already exists; do not recreate the branch. Stage only the five finalized reports using the prepared explicit allowlist, verify whitespace and exact paths, commit without amend, and capture the final head SHA. The complete phase remains 108 paths; bytecode/private fixtures/logs/archives remain excluded.

   ```sh
   git add --pathspec-from-file=/home/nearby/.t3/userdata/tmp/agfs-release-final-20261022-r77mvaoz/evidence-paths.txt
   git diff --cached --name-status
   git diff --cached --check
   git commit -m "Record final validation and release evidence for 50 workflows"
   RELEASE_HEAD_SHA=$(git rev-parse HEAD)
   ```

3. **Apply remote 0018 before new web activation.** With the additive/mixed-version contract cleared, run the existing production migration script and verify its exit status and the migration ledger. The command applies pending migrations, so first confirm 0018 is the only pending file. Stop the rollout on failure; do not activate code against an incomplete migration.

   ```sh
   umask 077
   pnpm d1:migrate:remote > "$RELEASE_LOG_DIR/migration.log" 2>&1
   ```

   This expands to `wrangler d1 migrations apply agfs-db --remote --env production` in the web package. The [0018 migration](../packages/db/src/migrations/0018_resource_controls.sql) adds projections, triggers, indexes, guards and durable cleanup state without changing original source-table column layouts. Index construction/backfills are one-time source-wide work with unmeasured production duration/cost. Keep the old-code/new-schema interval short. **Old workers still execute their old unbounded cleanup during that interval.** Compatibility does not make their CPU/work bounded.

4. **Push feature branch, open PR, register it, pass required CI.** An earlier feature push/PR can precede step 3 only if current branch builds are positively known to upload versions without activation and preserve bindings. Otherwise keep the conservative order. The prepared PR body records actual local passes; insert the verified remote migration result before creation. CI, merge and activation remain pending.

   ```sh
   git push git@github.com:nearbycoder/agfs HEAD:refs/heads/feature/50-workflows-2026-10-22
   gh pr create --repo nearbycoder/agfs --base main --head feature/50-workflows-2026-10-22 --title "Add 50 data preparation, Operations, and client workflows" --body-file /home/nearby/.t3/userdata/tmp/agfs-release-final-20261022-r77mvaoz/pr-body.md
   ```

   Root must call `link_pull_request` with the newly returned full URL immediately, then use the app-owned PR watcher if monitoring is needed. Do not register the unrelated earlier PR. This preflight created no PR and owns no watch. Resolve conversations and pass `verify` on the intended current head; if main advances, satisfy strict protection without force push and refresh affected evidence. Root must reconcile `list_thread_pull_requests` before finishing PR work.

5. **Merge the exact checked head; observe the main build/activation.** Confirm 0018 remotely immediately before this step, because merging main may activate the connected build automatically.

   ```sh
   gh pr merge "$PR_NUMBER" --repo nearbycoder/agfs --merge --match-head-commit "$RELEASE_HEAD_SHA"
   ```

   Record the resulting main merge SHA, its Cloudflare build check and the actual Workers deployment membership. Do not equate an uploaded version or green build with 100% traffic. Do not launch a competing manual deployment while the intended automatic activation is still running.

6. **Controlled direct web fallback only when needed and coordinated by root.** Use the exact merged/validated source. The existing production build reruns workspace tests, builds web in the production environment and runs its typecheck; it does not rebuild/deploy preview or CIMD. The expanded equivalent below makes plaintext preservation explicit without editing configuration:

   ```sh
   pnpm --filter @agfs/web run build:production > "$RELEASE_LOG_DIR/web-production-build.log" 2>&1
   (
     cd apps/web
     CLOUDFLARE_ENV=production node node_modules/wrangler/bin/wrangler.js deploy --keep-vars
   ) > "$RELEASE_LOG_DIR/web-deploy.log" 2>&1
   ```

   Run deployment only if the production build succeeds. Refresh client/server artifact hashes after that build; the historical 518-file standard-build manifest is not a production-build manifest. The existing shorthand can forward the same flag as `pnpm deploy:production --keep-vars`. Confirm the selected production name, domains and complete binding-name/type set from sanitized output/API metadata.

7. **Verify actual activation and bounded production behavior.** Only then replace PENDING with the real commit/PR/CI/migration/version/verification evidence. SDK/CLI/Python registry publication stays outside this rollout.

## Rollback kept ready

Primary web rollback target: **`3608285c-bca5-4f8d-8c65-4930c00efb2d`**. Reconfirm that it is the actual pre-release active version if time has passed. Preserve the final migration and generation/independent-GC-intent projections when rolling back code; do not drop/reset them, restore an older database over current writes, or disable allocator triggers. Old code ignores the new cleanup state and may leave independent intents for the new collector to retire later. The server author's mixed-version tests and final independent clearance support compatibility; migration rollback is not part of this plan.

Prepared command, **not executed**:

```sh
CI=1 WRANGLER_SEND_METRICS=false node apps/web/node_modules/wrangler/bin/wrangler.js rollback 3608285c-bca5-4f8d-8c65-4930c00efb2d --name agfs-dev-production --config apps/web/wrangler.jsonc --env production --yes --message "Restore pre-feature release after verification failure" > "$RELEASE_LOG_DIR/web-rollback.log" 2>&1
```

After rollback, verify that exact version has 100% traffic and repeat the bounded authorization/concurrency checks. Preview and CIMD remain on their observed versions. Prevent a pending automatic build from immediately reactivating the failed version through root-coordinated release control; do not race two deployment paths.

For exact bundle recovery if necessary, use `/accounts/0a4ba75d9277c4e96b49255f3109e7b6/workers/workers/agfs-dev-production/versions/3608285c-bca5-4f8d-8c65-4930c00efb2d?include=modules`. The ordinary `/workers/scripts/.../content/v2` endpoint can return the latest upload rather than the active rollback version. This preflight fetched metadata only and did not download modules.

The prior `aaa733b0-1011-4582-945c-970763d4740d` activation once stalled unauthenticated listing for 10–30 seconds, with canceled/low-CPU events, then later passed without a source change. Rollback to `0eb97275-ff4b-4bee-9c12-340c50002338` restored service at that time. No source defect or root cause was established; do not apply a speculative auth/TanStack patch. The current baseline is the newer observed `3608285c...` version. The old private diagnostic bundle at `/home/nearby/.t3/userdata/tmp/agfs-stall-stages-azxh_7fg` is stale and must not be treated as current code or deployed automatically.

## Verification still to run

**Before remote release:** all local runtime/browser/closure gates are complete. Both reports are handed off; finalize one evidence commit before the first push. Root authorized remote 0018, push and PR; merge and actual activation wait for required hosted CI and the next coordinated step.

**After activation:** use bounded public/absent-or-invalid-credential checks without production user mutations:

1. Read Workers deployment membership and verify the new web version at **100%**, unchanged preview/CIMD, the complete binding-name/type set, and applied migration 0018. Record timestamps and deployment/version IDs. A latest upload is not enough.
2. Reuse `/tmp/agfs-production-smoke-20261022.mjs` after the production rebuild. Its prior expected total is 22 checks: homepage/security header, current HTML-derived JS/CSS assets matched to fresh local bytes, both domains' unauthenticated listing/ranged-download refusals, MCP challenge, OAuth discovery, preview invalid-ticket GET/HEAD isolation and bodyless HEAD, and public CIMD metadata-validation transport. Record the actual current count and asset hashes; do not blindly reuse old filenames/hash results or dump returned error payloads.
3. Add one bounded wave of **six concurrent unauthenticated listings**, three per production domain, plus ordinary/invalid-DPoP authorization checks on representative list paths and an unauthenticated auth-session check. Expect prompt documented denials, without hangs, and normal homepage/session behavior. Record only method/path/status/elapsed time; no header/cookie/auth values. This observes concurrency and first-request behavior without claiming a guaranteed cold-isolate test. Do not force restarts or manufacture load.
4. Observe a small number of actual scheduled runs, tied to the **new version**, with outcome, CPU/wall time, cron/status and exception-presence booleans. Confirm the continued minute schedule; observe the natural hourly cleanup boundary when practical without manually triggering production cleanup. Do not infer scheduled health from homepage success. No production tail/probe was run by this preflight.
5. On the earlier stall signature or a new release regression, keep version-specific evidence and execute the prepared rollback under root coordination. If a tail is needed, filter it to version/outcome/CPU/wall/cron/status and this release's public probes. Never dump raw events, headers, cookies or user paths; any unavoidable transient raw capture must be private mode0600 and excluded from the repository.

Actual Worker CPU/isolate-memory distributions, D1 billed reads/writes/storage, queue retry/backlog, R2 retention and container usage remain unmeasured. They are follow-up evidence under the cost report, not claims supplied by local SQLite VM counts or this metadata preflight. No new usage collection or stress test is requested here.

## Sanitized evidence and handoff

Evidence directory: `/tmp/agfs-release-preflight-20261022-r8v_v0zy` (mode0700; evidence files mode0600).

- [GitHub metadata](/tmp/agfs-release-preflight-20261022-r8v_v0zy/github-metadata.json): auth readiness/scopes, main SHA, protection, baseline check URLs, unused branch and SSH ref read.
- [Cloudflare metadata](/tmp/agfs-release-preflight-20261022-r8v_v0zy/cloudflare-metadata.json), [exact-version/preview metadata](/tmp/agfs-release-preflight-20261022-r8v_v0zy/cloudflare-exact-version-and-preview.json), and [auth result](/tmp/agfs-release-preflight-20261022-r8v_v0zy/cloudflare-auth.json): active membership, binding names/types, cron, migration ledger and UTC timestamps. The initial version projection used a different response shape; the separate exact-version file contains the corrected top-level binding/version metadata.
- [Local inventory](/tmp/agfs-release-preflight-20261022-r8v_v0zy/local-inventory.json), [ownership/exclusions](/tmp/agfs-release-preflight-20261022-r8v_v0zy/ownership-and-exclusions.json), [config metadata](/tmp/agfs-release-preflight-20261022-r8v_v0zy/config-metadata.json), and [proposed allowlist](/tmp/agfs-release-reconcile-20261022-0d9zatj7/release-paths.txt).
- [Historical artifact verification](/tmp/agfs-release-preflight-20261022-r8v_v0zy/frozen-artifact-verification.json), [build source delta](/tmp/agfs-release-preflight-20261022-r8v_v0zy/build-source-delta.json), [standard command metadata](/tmp/agfs-release-preflight-20261022-r8v_v0zy/standard-validation-metadata.json), and [sanitized counts](/tmp/agfs-release-preflight-20261022-r8v_v0zy/validation-counts.json). The original owner summary is [standard-validation.json](/home/nearby/.t3/userdata/tmp/agfs-integration-r2-fixes-fz0av2ca/standard-validation.json).
- [PENDING PR body](/home/nearby/.t3/userdata/tmp/agfs-release-final-20261022-r77mvaoz/pr-body.md): prepared text only; no GitHub write.

**Phase 1 is authorized and local validation is complete.** Final evidence commit, remote migration, feature push and PR are the next release actions. Required CI, merge, actual activation and production verification remain pending. No deployment or production-cost claim is made. The metadata observations above remain timestamped; subsequent release actions will be recorded in sanitized handoff evidence. No new user approval is needed.
