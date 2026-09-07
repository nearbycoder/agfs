# Workspace interaction review

The zinc workspace uses shared tables, disclosure panels, file links, loading states, and row action menus. The UI keeps existing API permissions, destructive-action confirmations, retained versions, and unsaved-edit guards.

## Interaction conventions

- File and token actions open an anchored, keyboard-accessible menu. Opening it does not resize the row. Escape closes the menu and restores trigger focus.
- Tables use the same header, spacing, selection treatment, and focusable scroll container. Wide CSV and comparison tables scroll within their panel.
- Disclosures use native summary keyboard behavior, consistent chevrons and spacing, and progressive CSS motion. Reduced-motion settings disable animation. Unsupported animation features fall back to native opening.
- File tools import on demand, preload code on pointer/focus intent, and mount on first opening. Visited tools remain mounted so edits and navigation guards survive collapse.
- Review results, manifests, new secrets, preview URLs, and share URLs receive focus when opened. Raw manifests and full comparisons remain available as progressive detail.
- Workspace identity loads independently from owner-only account totals, so editor/viewer accounts retain a working workspace selector.
- Folder links navigate through the router. File links remain download requests; pinned run downloads continue to use the retained-manifest endpoint.
- Activity renders at most 100 events per page, while filtering and CSV exports cover all loaded events. CSV filtering is deferred and memoized. Folder and shared-list requests cancel superseded work.

## Verification coverage

All 15 workspace routes were checked at 390px and 1440px, including available expanded panels: Files, Library, Search, File tools, Shares, Agent runs, Draft changes, Tokens, Agent budgets, Webhooks, Workspaces, Storage insights, Activity, Trash & versions, and Operations & recovery.

Populated local fixtures cover files/folders, favorites, collections, completed run comparisons and manifests, draft before/after review, active/expired shares, paused webhooks with failed delivery history, budgets, recovery entries, and snapshots. Focused checks cover file menu geometry and keyboard dismissal, preview/share result focus, custom select filtering, CSV row filtering, JSON tree collapse, editor state retention and unsaved navigation confirmation, and Activity pagination/export counts.

Public checks include the homepage, CLI guide, device connection, signed-out app/consent gates, missing-page state, and invalid share response. Share URLs are download endpoints; invalid ones intentionally return an HTTP error rather than an app page.

Build, type checks, unit tests, dependency audit, and the integration suite run separately. Authenticated UI verification uses disposable local fixtures; production verification checks public/auth boundaries and deployed asset hashes. No synthetic user sessions are added to production.

This is a functional and visual review, not a claim of formal accessibility certification or exhaustive coverage of every possible account state.
