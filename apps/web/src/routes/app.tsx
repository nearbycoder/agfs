// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/AppShell";
import { AuthGate } from "~/components/AuthGate";
import { NOINDEX_ROBOTS, buildSeoHead, pageTitle } from "~/lib/seo";

export const Route = createFileRoute("/app")({
  head: () =>
    buildSeoHead({
      title: pageTitle("Workspace"),
      description: "Private AGFS workspace for browsing files, issuing preview links, and managing automation credentials.",
      robots: NOINDEX_ROBOTS,
    }),
  component: AppRoute,
});

function AppRoute() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}
