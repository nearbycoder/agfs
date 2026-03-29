// @ts-nocheck
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, LaptopMinimal, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { authClient } from "~/lib/auth-client";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { NOINDEX_ROBOTS, buildSeoHead, pageTitle } from "~/lib/seo";

export const Route = createFileRoute("/device")({
  head: () =>
    buildSeoHead({
      title: pageTitle("Approve Device Login"),
      description: "Approve a waiting AGFS CLI login from the browser and hand access back to the terminal securely.",
      robots: NOINDEX_ROBOTS,
    }),
  validateSearch: z.object({
    user_code: z.string().optional(),
  }),
  component: DevicePage,
});

function DevicePage() {
  const { user_code } = Route.useSearch();
  const session = authClient.useSession();
  const [label, setLabel] = useState("CLI login");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    await authClient.signIn.social({
      provider: "github",
      callbackURL: user_code ? `/device?user_code=${encodeURIComponent(user_code)}` : "/device",
    });
  }

  async function handleApprove() {
    setError(null);
    setStatus(null);
    const response = await fetch("/api/v1/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode: user_code, label }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Failed to approve device");
      return;
    }
    setStatus("This CLI session has been approved. You can return to the terminal.");
  }

  return (
    <main className="status-shell">
      <Card className="max-w-2xl">
        <CardHeader className="space-y-5">
          <Badge className="w-fit" variant="secondary">
            CLI approval
          </Badge>
          <div className="space-y-4">
            <CardTitle className="text-3xl tracking-[-0.05em]">Approve a waiting AGFS device login.</CardTitle>
            <CardDescription className="max-w-xl text-base leading-7">
              {user_code
                ? `Approve the CLI session for code ${user_code}.`
                : "Open this page from the device-login URL shown by the CLI."}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="flex items-center gap-3">
                <LaptopMinimal className="size-4 text-zinc-600 dark:text-zinc-300" />
                <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">Waiting terminal</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">The CLI is polling for approval and will continue automatically once this page grants access.</p>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="flex items-center gap-3">
                <ShieldCheck className="size-4 text-zinc-600 dark:text-zinc-300" />
                <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">Account scoped</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">Approvals mint AGFS tokens tied to your account and label them for later review.</p>
            </div>
          </div>

          {user_code ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/80">
              <p className="section-label">User code</p>
              <p className="mt-2 font-mono text-lg tracking-[0.2em] text-zinc-950 dark:text-zinc-50">{user_code}</p>
            </div>
          ) : null}

        {!session.data?.user ? (
          <Button onClick={handleSignIn} type="button">
            Sign in with GitHub
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="section-label" htmlFor="device-label">
                Session label
              </label>
              <Input id="device-label" onChange={(event) => setLabel(event.target.value)} value={label} />
            </div>
            <Button disabled={!user_code} onClick={handleApprove} type="button">
              Approve device
            </Button>
          </div>
        )}

          {status ? (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertTitle>Approved</AlertTitle>
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Approval failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
