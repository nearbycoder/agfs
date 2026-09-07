# Twenty additions using existing infrastructure

Each numbered feature ships in its own PR after focused verification and required CI. Existing Cloudflare Workers, D1, R2, browser APIs, and installed dependencies only. No new service accounts.

| # | Feature and acceptance criteria | PR |
|---|---|---|
| 1 | Personal workspace favorites: add/remove, survive renames, hide deleted files, isolate users/workspaces. | pending |
| 2 | Saved searches: named reusable filters, rename/delete, user/workspace isolation. | pending |
| 3 | File notes: bounded shared annotations, timestamps, permission checks, conflict detection. | pending |
| 4 | Collections: named sets of existing files, add/remove members, rename/delete, follow file moves. | pending |
| 5 | Advanced search: size, modification date, file/folder filters with stable pagination and reset. | pending |
| 6 | Storage insights: live totals, type distribution, largest files, folder-scoped summaries. | pending |
| 7 | Duplicate finder: checksum/size groups, inspect paths, report potential reclaimable space without deleting. | pending |
| 8 | Browser text editor: bounded text loading, conditional save, unsaved-change warning, conflict handling. | pending |
| 9 | File templates: reusable text templates, built-in starters, safe create-only instantiation. | pending |
| 10 | Batch rename: preview prefix/suffix replacements, collision validation, per-file outcomes. | pending |
| 11 | CSV inspector: quoted-field parser, bounded rendering, column filter, malformed input feedback. | pending |
| 12 | JSON inspector: validation, tree inspection, formatted/raw views, copy, safe text rendering. | pending |
| 13 | Text comparison: compare two accessible files, bounded line diff, change counts. | pending |
| 14 | Folder README: discover/read documentation in the current folder, safe rendering, loading/error states. | pending |
| 15 | Command palette: searchable navigation/actions, keyboard shortcut, accessible focus and Escape behavior. | pending |
| 16 | Recent files: personal workspace history, open/remove/clear, live permission checks. | pending |
| 17 | Activity explorer: action/path/date filters and formula-safe CSV export of matching loaded records. | pending |
| 18 | Run comparison: compare statuses, metadata and retained input/output manifests. | pending |
| 19 | Share review: expiry/status filters, expiry summaries, selected revocation with explicit confirmation/results. | pending |
| 20 | Folder upload: preserve directory structure, validate paths, show progress and per-file failures, retry safely. | pending |

Final verification includes disposable integration fixtures, production migration/deployment checks, and browser verification of the new flows. Feature-specific bounds and behavior are documented with each PR.
