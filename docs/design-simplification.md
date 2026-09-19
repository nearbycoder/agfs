# Simpler workspace design

Everyday tasks now take priority, with optional controls available through progressive disclosure. The existing zinc theme, custom selects, shared tables, focus styles, and reduced-motion support remain in use.

## Changes

- **Navigation:** Six everyday destinations stay visible. Automation and management pages live in an expandable section that opens automatically when one of its pages is active. The command palette still searches every destination, and workspace switching stays at the top.
- **Files:** Upload and New folder are the primary actions. Folder creation opens beside the current task and focuses its input. Download and selection tools appear when files are selected. Folder-by-path navigation, folder uploads, and listing exports are grouped below the file list. Handoff state stays mounted even when the selection is cleared.
- **Search:** A single search field leads the page. Optional folder, type, tag, size, and date filters show an active count when collapsed. Saved searches are expandable; the tag editor appears only after choosing a result.
- **File tools:** Search across all tools or browse Write, Inspect, Convert, Compare, and Verify. Only matching tools are shown, with four writing tools as the default. Editors load on demand, keep entered values when switching categories, and still support direct hash links.
- **Runs:** Name and output folder remain visible; retention and input paths move into advanced settings with a current-value summary. Comparison follows the run list.
- **Tokens:** Folder scope and permissions remain explicit. Expiration moves into advanced settings with duration examples. The secret panel appears only when there is a secret to copy.
- **Workspaces:** Workspace settings are separated from team invitations. Joining another workspace is expandable and opens automatically for an invitation link.
- **Webhooks:** The endpoint leads the form. Folder and event configuration is expandable, with the chosen values visible in its summary.
- **Operations:** Health totals and alerts stay visible. Route metrics, thresholds, and indexing repair are grouped under advanced diagnostics.

Advanced controls retain their values when collapsed. Invalid fields reopen their section rather than leaving an inaccessible validation failure. No API contracts, permissions, services, or database migrations change.

## Verification

- All 15 app routes reviewed at 1280×800 and 390×844: 30 page checks, with no page overflow, error alerts, or browser errors.
- Desktop and phone screenshots inspected, including light and dark file views. Phone file filters share a row to keep the list closer to the top.
- Browser interactions verified: folder creation, search filter retention and reset, invalid-field reveal/focus, tool search, category switching with retained input, direct tool links, automatic advanced navigation, and mobile Escape/focus restoration.
- Token creation verified from the form through the API and local database: read-only access with a seven-day expiration.
- Handoff notes verified to survive clearing and restoring the file selection.
- Web build and type checks pass. Repository tests pass, including 160 web tests. The full disposable Workers integration suite passes with Node 24, matching CI. Dependency audit is clean.

CI also exposed a request-stream regression from the preceding security pass. The JSON parser now discards small oversized tails without retaining them, with a 64 KiB threshold before cancelling larger streams. The accepted JSON limit stays at 16 KiB. Two stream tests, 36 HTTP security checks, and 75 consecutive oversized/follow-up requests verify bounded rejection and reuse.
