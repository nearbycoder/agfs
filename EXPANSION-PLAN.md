# Twenty additions using existing infrastructure

Each numbered feature ships in its own PR after focused verification and required CI. Existing Cloudflare Workers, D1, R2, browser APIs, and installed dependencies only. No new service accounts.

| # | Feature and acceptance criteria | PR |
|---|---|---|
| 1 | Personal workspace favorites: add/remove, survive renames, hide deleted files, isolate users/workspaces. | [#11](https://github.com/nearbycoder/agfs/pull/11) merged |
| 2 | Saved searches: named reusable filters, rename/delete, user/workspace isolation. | [#12](https://github.com/nearbycoder/agfs/pull/12) merged |
| 3 | File notes: bounded shared annotations, timestamps, permission checks, conflict detection. | [#13](https://github.com/nearbycoder/agfs/pull/13) merged |
| 4 | Collections: named sets of existing files, add/remove members, rename/delete, follow file moves. | [#14](https://github.com/nearbycoder/agfs/pull/14) merged |
| 5 | Advanced search: size, modification date, file/folder filters with stable pagination and reset. | [#15](https://github.com/nearbycoder/agfs/pull/15) merged |
| 6 | Storage insights: live totals, type distribution, largest files, folder-scoped summaries. | [#16](https://github.com/nearbycoder/agfs/pull/16) merged |
| 7 | Duplicate finder: checksum/size groups, inspect paths, report potential reclaimable space without deleting. | [#17](https://github.com/nearbycoder/agfs/pull/17) merged |
| 8 | Browser text editor: bounded text loading, conditional save, unsaved-change warning, conflict handling. | [#18](https://github.com/nearbycoder/agfs/pull/18) merged |
| 9 | File templates: reusable text templates, built-in starters, safe create-only instantiation. | [#19](https://github.com/nearbycoder/agfs/pull/19) merged |
| 10 | Batch rename: preview prefix/suffix replacements, collision validation, atomic all-or-nothing application. | [#20](https://github.com/nearbycoder/agfs/pull/20) merged |
| 11 | CSV inspector: quoted-field parser, bounded rendering, column filter, malformed input feedback. | [#21](https://github.com/nearbycoder/agfs/pull/21) merged |
| 12 | JSON inspector: validation, tree inspection, formatted/raw views, copy, safe text rendering. | [#22](https://github.com/nearbycoder/agfs/pull/22) merged |
| 13 | Text comparison: compare two accessible files, bounded line diff, change counts. | [#23](https://github.com/nearbycoder/agfs/pull/23) merged |
| 14 | Folder README: discover/read documentation in the current folder, safe rendering, loading/error states. | [#24](https://github.com/nearbycoder/agfs/pull/24) merged |
| 15 | Command palette: searchable navigation/actions, keyboard shortcut, accessible focus and Escape behavior. | [#25](https://github.com/nearbycoder/agfs/pull/25) merged |
| 16 | Recent files: personal workspace history, open/remove/clear, live permission checks. | [#26](https://github.com/nearbycoder/agfs/pull/26) merged |
| 17 | Activity explorer: action/path/date filters and formula-safe CSV export of matching loaded records. | [#27](https://github.com/nearbycoder/agfs/pull/27) merged |
| 18 | Run comparison: compare statuses, metadata and retained input/output manifests. | [#28](https://github.com/nearbycoder/agfs/pull/28) merged |
| 19 | Share review: expiry/status filters, expiry summaries, selected revocation with explicit confirmation/results. | [#29](https://github.com/nearbycoder/agfs/pull/29) merged |
| 20 | Folder upload: preserve directory structure, validate paths, show progress and per-file failures, retry safely. | pending |

Final verification includes disposable integration fixtures, production migration/deployment checks, and browser verification of the new flows. Feature-specific bounds and behavior are documented with each PR.
