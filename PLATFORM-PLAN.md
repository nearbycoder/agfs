# Collaborative agent platform release

All ten requested features are in scope. Existing personal files, API tokens, CLI commands, and stateless MCP remain compatible.

- [x] Shared team workspaces and role enforcement
- [x] Filename/content/tag/type search with authorization applied before results
- [x] OAuth MCP discovery, browser consent, folder/permission selection
- [x] Conditional writes and conflict responses
- [x] Signed file-event webhooks, retries, delivery history
- [x] Agent runs and immutable artifact manifests
- [x] Draft change sets, diffs, review, atomic application
- [x] CLI sync/watch with ignores, dry-run and conflicts
- [x] TypeScript and Python SDKs
- [x] Workspace/agent budgets, usage and pause controls
- [x] Local migrations, regression/security tests and browser verification
- [ ] Production migrations, merge, deployment and package publication

Implementation decisions: preserve personal namespaces; introduce workspace storage principals separate from real actors; session membership and token permissions intersect on every request. Search starts with indexed text and metadata, as proposed, without making semantic AI services a deployment prerequisite. No invitations or webhook test messages are sent to third parties during development.
