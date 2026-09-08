# Second feature wave

Twenty independent additions, each delivered in its own verified PR. No new hosted services, accounts, or paid integrations. Existing workspace permissions and storage remain authoritative; conversions run in the browser and do not overwrite source files.

| # | Feature | Complete behavior | Status |
|---|---|---|---|
| 1 | Directory browser controls | Name/path filtering, file/folder filter, natural name/size/date sort, 100-row pages, selection across pages | Implemented and verified |
| 2 | File properties | Inspect metadata, timestamps, MIME, size and ETag; copy paths/checksum | Implemented and verified |
| 3 | Go to folder | Validated direct-path navigation with parent/root shortcuts and browser history | Implemented and verified |
| 4 | Selection clipboard | Copy selected paths as lines, JSON or shell-safe arguments; visible count and clipboard errors | Implemented and verified |
| 5 | Directory inventory export | Export all matching entries as metadata-rich JSON or spreadsheet-safe CSV | Implemented and verified |
| 6 | Editor find & replace | Literal case-sensitive/insensitive matching, preview counts, replace in draft, undo before save | Implemented and verified |
| 7 | Editor line navigation | Go to a valid line, select it, wrap control and cursor/selection position | Implemented and verified |
| 8 | Text cleanup recipes | Preview line-ending, trailing-space, tab and blank-line cleanup; apply to draft and undo | Implemented and verified |
| 9 | Markdown reading room | Safe document preview, navigable heading outline, reading statistics and source view | Planned |
| 10 | CSV column profiles | Missing/distinct counts, numeric summaries, common values and malformed-row reporting | Planned |
| 11 | Filtered CSV download | Export all matched rows or current page with chosen delimiter and spreadsheet protection | Planned |
| 12 | CSV to JSON | Header validation, explicit string preservation, preview and downloadable records | Planned |
| 13 | JSON to CSV | Object-array validation, union columns, nested-value serialization, protected CSV export | Planned |
| 14 | JSONL log explorer | Parse line-delimited logs, expose malformed lines, search/filter levels and paginate | Planned |
| 15 | JSON Pointer extraction | Resolve escaped pointer paths, distinguish missing/null, preview and export selected data | Planned |
| 16 | JSON structural comparison | Added/removed/changed paths, type-aware comparison, bounded results and export | Planned |
| 17 | SHA-256 verification | Hash a local file in-browser, compare an expected checksum, copy/download receipt | Planned |
| 18 | Encoding workbench | Strict UTF-8/Base64/hex conversion with validation, preview and download | Planned |
| 19 | Release handoff builder | Assemble selected artifacts with release notes into a previewed, downloadable or create-only Markdown handoff | Planned |
| 20 | Command palette file search | Debounced permission-checked file search, keyboard navigation and folder/tool shortcuts | Planned |

Each PR includes relevant pure-logic tests or focused browser verification, the required CI suite, and a review before merge. The final combined release is deployed to Cloudflare and checked against the merged build.
