import { createFileRoute } from "@tanstack/react-router";
import { AgentToolsPage } from "~/components/platform/AgentToolsPage";
import { NOINDEX_ROBOTS, buildSeoHead, pageTitle } from "~/lib/seo";
export const Route = createFileRoute("/app/agent-tools")({
  head: () =>
    buildSeoHead({
      title: pageTitle("Agent workbench"),
      description:
        "Prepare context, transform agent inputs, inspect artifacts, and verify webhook deliveries.",
      robots: NOINDEX_ROBOTS,
    }),
  component: AgentToolsPage,
});
