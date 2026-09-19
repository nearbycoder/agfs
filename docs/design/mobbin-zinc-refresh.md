# Zinc styling refresh

The app keeps its neutral zinc palette and existing functionality. This pass makes the shared interface more consistent and gives file content more room, using references reviewed through Mobbin's MCP tools.

## References and interpretation

- [Supabase storage browser](https://mobbin.com/screens/56d69f0f-9dac-4c34-9d70-00d5e36020e2): compact navigation and controls around the file list. AGFS uses a single heading/action row and a compact folder filter toolbar.
- [Customer.io advanced settings](https://mobbin.com/screens/37dd749a-e15f-4c2d-92e1-eab0e53d24d1): grouped settings with labels, descriptions, and clear disclosure affordances. AGFS keeps optional settings collapsed and uses consistent expanded surfaces.
- [Retool product introduction](https://mobbin.com/sites/sections/dcbd55be-58cb-4e0e-9b70-cb4d184fa30a): product-led presentation with a restrained frame around the interface. AGFS retains its own copy, artwork, and product screenshot.

No third-party screenshots or assets are shipped. The homepage preview is captured from an isolated local workspace containing fictional sample files and an example.test account.

## Shared styling

- Softer zinc backgrounds, white/charcoal content surfaces, consistent radii, and readable muted text in both themes.
- Quiet sidebar chrome, a distinct active navigation marker, a compact workspace selector, and a search entry point.
- Shared table typography and row states. Wide data tables scroll within their own region on small screens; the file browser keeps its compact mobile layout.
- Consistent cards, nested settings, custom selects, badges, empty states, command menus, and documentation framing.
- Brief CSS entry/interaction transitions that respect reduced motion. No new runtime dependencies, requests, or services.

## Verification

The local browser review covers all 15 app routes and the home, CLI, device, OAuth consent, and not-found screens at 1440px and 390px in both themes (80 combinations). It checks headings, horizontal page overflow, consistent table wrappers, error alerts, and browser errors, and captures screenshots for visual review. Focused interaction checks cover custom selects, file actions, expanded settings, command search, mobile navigation, and reduced motion.

Existing workspace tests, production build, type checks, GitHub CI, and Cloudflare branch/production builds are required before release.
