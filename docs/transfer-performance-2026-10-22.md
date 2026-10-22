# SDK and CLI performance — October 22, 2026

Four transfer improvements complete the twenty-item performance refresh alongside the eight server and eight browser improvements.

1. **Bounded parallel SDK multipart uploads.** `upload` and `uploadSource` now accept `concurrency: 1..8`, `upload` defaults to three; `uploadSource` keeps a sequential default for compatibility with custom readers. The scheduler overlaps independent parts while retaining at most one 8 MiB chunk per worker, waits for in-flight work on failure, and commits only after all parts succeed. Progress counts acknowledged bytes, so out-of-order completions never move the progress indicator backwards. Custom readers must provide independent offset reads and owned, stable buffers; sequential readers can select one worker. This is per upload; callers running many uploads should budget their aggregate concurrency.
2. **Reuse the fingerprint chunk.** The first chunk's bytes and SHA-256 digest are reused for the first uploaded/resumed part. A file with N parts now needs N source reads and hashes rather than N+1, saving up to 8 MiB of reads and hashing per attempt. The first chunk is still verified against its server-side digest; it is the same byte snapshot used in the upload fingerprint. Short reads fail before creating a remote upload.
3. **Indexed resume verification.** A validated map of part number to digest replaces repeated linear searches through resume metadata. Checking N resumed parts now performs N map lookups instead of up to N² metadata comparisons. Every part's local bytes are still hashed. Ambiguous duplicate records, invalid digests and out-of-range part numbers are rejected.
4. **Bounded parallel CLI folder downloads.** `agfs download /folder ./destination --concurrency 4` streams four files at a time by default, configurable from one to eight. The existing temporary-file, size-check, symlink and atomic-replacement protections remain active for each file. Duplicate remote destinations are rejected before writes begin. The command waits for active downloads before reporting failure; a folder download is not a multi-file atomic transaction.

Implementation: `packages/sdk/src/index.ts`, `packages/sdk/src/concurrency.ts`, `packages/cli/src/lib/client.ts`, `packages/cli/src/lib/download.ts`, and `packages/cli/src/commands/fs.ts`.

## Verification

- SDK regression tests control part completion order and verify two-worker concurrency, one source read per part, monotonic progress, changed-part re-upload, cancellation, invalid limits/metadata, and no commit or additional scheduling after failure.
- CLI regression tests hold response streams open to verify the selected concurrency, wait for all resulting file contents, and cover duplicate destinations, symlinks, hard links, short downloads and compressed-response sizes.
- `node scripts/transfer-benchmark.mjs` compares sequential and three-worker SDK uploads using six 8 MiB parts and a simulated 50 ms response delay. It reports elapsed time, observed request concurrency, source reads and transferred bytes. It makes no external network calls. Results demonstrate scheduling behavior, not production bandwidth or Cloudflare latency.

## Additional security fixes

The CLI now validates HTTPS origins (with loopback HTTP permitted for local development), rejects API redirects, validates empty-file upload capability IDs and paths, and rejects paths that normalize outside `/api/v1/`. Empty uploads send the capability to the configured client origin, even when the API advertises a different canonical hostname; they never follow an advertised foreign origin or send the account bearer token on the capability request. Tests cover `www.agfs.dev`/`agfs.dev`, loopback aliases, and an untrusted advertised origin. The SDK receives equivalent path/capability handling, rejects non-finite or invalid retry budgets, and never retries a non-replayable streaming request body. The scheduler preserves the first error when multiple active tasks fail.

Independent review identified the alias-origin regression and a clean-checkout test dependency on generated SDK output. Both were corrected: CLI Vitest resolves the workspace SDK source, and all 49 SDK/CLI tests passed with `packages/sdk/dist` temporarily absent. Full combined validation is recorded in [the maintenance report](maintenance-2026-10-22.md).
