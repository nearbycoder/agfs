// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/AppShell";
import { AuthGate } from "~/components/AuthGate";

export const Route = createFileRoute("/app")({
  component: AppRoute,
});

function AppRoute() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}
