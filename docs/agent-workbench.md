# Agent workflow additions

This additive feature wave provides 15 browser workbench tools and five run-management improvements. Open **Automation & settings → Agent workbench** at `/app/agent-tools`, or find a tool with Ctrl/Command K. Existing file tools, public routes, APIs, authentication and storage contracts remain available.

| # | Addition | Behavior |
| --- | --- | --- |
| 1 | Context pack builder | Bundle 1–20 accessible UTF-8 workspace files with instructions, source paths and ETags. Preserve order. Refuse oversized packs visibly, without truncation. |
| 2 | Context chunker | Split context on whole lines with numbered chunks, source line ranges and 0–20 overlap lines. Reject indivisible oversized lines. |
| 3 | Prompt variable renderer | Render `{{name}}` variables from a JSON object of strings, once as literal text. Report missing or invalid variables. |
| 4 | JSON merge patch | Preview RFC 7396 recursive object merging, null-key removal and array/scalar replacement. |
| 5 | JSON Pointer redaction | Replace explicitly selected values with `[REDACTED]`. Resolve escaped keys and array indices. Reject missing or malformed paths before returning output. |
| 6 | JSON shape profiler | Inventory observed paths, types and occurrence counts. Array items share a wildcard path. This is a sample profile, not a validation schema. |
| 7 | JSON record selector | Filter an array by exact JSON representation, substring, presence or absence of a nested pointer. Null and missing remain distinct. |
| 8 | JSON array to JSONL | Write one exact JSON value per line, including scalar and null records. |
| 9 | JSONL to JSON array | Combine valid records, skip blank lines and report malformed source line numbers. Check aggregate depth and value limits. |
| 10 | CSV column projection | Choose and reorder distinct named columns. Reject unknown columns, duplicate headers and ragged rows. |
| 11 | CSV keyed join | Left/inner joins on a common column. Require unique nonempty right-side keys and resolve output header collisions. |
| 12 | CSV to Markdown table | Generate a table with escaped pipes, backslashes and HTML angle brackets; normalize multiline cells. |
| 13 | Line set comparison | Find shared, left-only, right-only or combined unique items. Preserve first-seen order and optionally trim each item. |
| 14 | Path scope tester | Preview absolute-path globs using `*`, `**`, `**/` and `?`, with a work limit. Does not alter token permissions. |
| 15 | Webhook signature verifier | Verify exact request bytes with HMAC-SHA256 and Web Crypto, handle rotation signatures, and check the past-five-minute timestamp window. Secret/body remain local. |
| 16 | Run explorer | Search loaded runs by name, folder, ID or metadata, filter status and inspect running/completed counts. Load more to include older runs. |
| 17 | Run metadata | Add up to 30 string labels and 8 KiB of metadata when starting a run. Uses the existing run API. |
| 18 | Rerun preparation | Populate a new-run form with the same input paths and metadata and a separate output folder. Starting captures current live versions; it does not replay retained content. |
| 19 | Markdown run report | Preview, copy, download or create a report containing run metadata, retained inputs, outputs, version ETags and available checksums. Missing checksums are identified. |
| 20 | Selection-to-run shortcut | Select 1–50 files in the Files page, then prepare them as run inputs. Paths are encoded and validated; preparation does not start the run or change files. |

## Bounds and data handling

Browser transformations accept at most 256 KiB per input and generated output. JSON processing preserves exact number literals, rejects duplicate object keys, and retains the existing 40-level/10,000-value parser bounds. CSV processing retains the existing 5,000-row/200-column bounds. Generated CSV includes spreadsheet-formula protection, which prefixes risky cells with an apostrophe.

Context packs estimate tokens as UTF-8 bytes divided by three. This is a heuristic rather than a model tokenizer; the displayed budget is approximate. Packs retain entire files and fail if the estimate or byte limit is exceeded. A pack contains its selected file contents, so review it before sharing with an agent. Redaction covers only the pointers you select and is not automatic secret detection.

Each ordinary tool can load permission-checked workspace text or pasted/local text, then preview and export the result. Creating an output file uses the existing upload API with `ifMatch: null`, which refuses an existing destination. Sources are not overwritten. The signature verifier has no workspace load/save controls and sends no network request; event-ID deduplication still belongs in the webhook receiver.

Run metadata, reruns and selection shortcuts use the existing run permission and retention behavior. The old run routes remain valid. No migration, hosted service, dependency upgrade, production deployment or infrastructure change is required.

## Validation

Run `pnpm test`, `pnpm check` and `pnpm --filter @agfs/web build`. New focused tests cover exact-number preservation, JSON patch/redaction, CSV joins/projection, glob bounds, whole-line chunking, budget refusal, webhook signatures/freshness and run shortcuts/reports.

The local review uses a separately persisted Cloudflare fixture state at `/tmp/agfs-agent-workflow-qa`, disposable `workflow-alice`/`workflow-bob` accounts with `example.test` addresses, and an app bound only to localhost:3037. No production credentials or data are used. Browser checks cover all tools, error paths, run creation/rerun/report, selected-file inputs, command-palette keyboard navigation, mobile navigation, and both themes. The companion [design review](design/agent-workbench-refresh.md) records references and final verification results.
