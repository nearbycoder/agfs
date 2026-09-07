# Browser workspace tools

All features use the existing AGFS service and your current workspace permissions. Open the app at `/app/files`; use **Find a command** or **Ctrl/Command K** to reach pages and individual tools.

| Feature | Where and how to use it |
|---|---|
| Favorites | Library: add a file or folder path, open it later, or remove the shortcut. Up to 200 per person/workspace. |
| Saved searches | Search: save a named query and its filters, then reuse, rename or delete it. Up to 100 per person/workspace. |
| File notes | File tools: load a file/folder path and add a shared annotation, up to 4,000 characters. Revision checks prevent lost updates; viewers can read. |
| Collections | Library: organize existing files into named personal sets. Up to 50 collections with 200 entries each; deleting a collection leaves files intact. |
| Advanced search | Search: combine kind, size, date, path, text and tag filters. Pagination retains the submitted filter set. |
| Storage insights | Storage insights: scope totals, largest files, file types and folder usage to a folder. |
| Duplicate finder | Storage insights: inspect groups with matching stored checksum and size. Results report potential extra bytes and never delete files. |
| Text editor | File tools: open, edit, create or copy UTF-8 files up to 256 KiB. Conditional saves reject concurrent changes and keep recovery versions. Unsaved edits prompt before leaving. |
| File templates | File tools: start from Markdown, JSON, CSV or handoff templates, or save up to 50 personal templates. Preview `{{name}}` and UTC `{{date}}` substitutions. Creation refuses existing destinations. |
| Batch rename | Files: select up to 50 files, preview literal find/replace and prefix/suffix options, preserve extensions, then apply. Sources and destinations are checked atomically; collisions or stale files rename nothing. Paths must be canonical. Requests are subject to the existing 16 KiB API body limit. |
| CSV inspector | File tools: choose comma, semicolon or tab, optional headers, column-aware filtering and 50-row pages. Supports quoted commas, escaped quotes and multiline cells. Maximum 5,000 rows and 200 columns. |
| JSON inspector | File tools: validate, expand paths, search keys/values, switch tree/formatted/raw views and copy formatting. Maximum 40 levels and 10,000 values. Formatted source preserves exact number literals and duplicate keys; the tree uses JavaScript number semantics. |
| Text comparison | File tools: compare two files with line numbers, addition/removal counts, optional whitespace normalization and a changes-only view. Maximum 1,500 lines per file and one million line pairs. |
| Folder README | Files: expand the discovered README for basic Markdown headings, lists and code, or view source/download. HTML, links and images stay inert. Maximum 5,000 lines. |
| Command palette | Ctrl/Command K: search navigation or tool actions, use arrows/Enter, and close with Escape. Tool shortcuts open the relevant panel. |
| Recent files | Library: your last 100 files opened in browser text tools or downloaded through a web session. Remove individual entries or clear history. Agent token activity is excluded. |
| Activity explorer | Activity: combine action, path, actor/token and local-date filters, then export exactly the matching loaded events. CSV cells are protected against spreadsheet formulas. Load older pages to include more history, up to 5,000 events. |
| Run comparison | Agent runs: compare two runs' status, timing, metadata, retained inputs and completed output manifests. Outputs match relative to each run folder; inputs use full paths. This does not extend retention. |
| Share review | Shares: filter active, expired or revoked links and those expiring within 24 hours. Select up to 50 active matches, confirm revocation and inspect each result. Failed selections can be retried. |
| Folder upload | Files: choose a folder, review the fixed destination, then upload up to 500 files with nested paths preserved. Progress and per-file outcomes support pause/resume and retry of unfinished files. Existing files are never replaced. Empty files work; browsers omit empty directories. Keep the page open during transfer. |

Favorites, collections, saved searches, templates and recent history belong to the current person and workspace. File notes are shared with people who can read the file. Favorites, collection membership, notes and recent entries follow file IDs through renames and disappear when their referenced file is deleted.

Text-based tools share the same permission-checked 256 KiB UTF-8 read limit. Binary data and malformed text produce errors. File operations retain existing storage quotas, path scopes, conditional-write checks and recovery behavior.

Each feature was delivered in its own verified, merged PR: [implementation checklist](../EXPANSION-PLAN.md).
