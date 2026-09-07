// @ts-nocheck
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, LaptopMinimal, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { authClient } from "~/lib/auth-client";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { NOINDEX_ROBOTS, buildSeoHead, pageTitle } from "~/lib/seo";

export const Route = createFileRoute("/device")({
  head: () =>
    buildSeoHead({
      title: pageTitle("Approve Device Login"),
      description:
        "Approve a waiting AGFS CLI login from the browser and hand access back to the terminal securely.",
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
      callbackURL: user_code
        ? `/device?user_code=${encodeURIComponent(user_code)}`
        : "/device",
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
    setStatus(
      "This CLI session has been approved. You can return to the terminal.",
    );
  }

  return (
    <main className="status-shell">
      <Card className="w-full max-w-xl">
        <CardHeader className="space-y-5">
          <Badge className="w-fit" variant="secondary">
            CLI approval
          </Badge>
          <div className="space-y-4">
            <h1 className="dashboard-title">Connect your terminal</h1>
            <CardDescription className="max-w-xl text-base leading-7">
              {user_code
                ? `Approve the CLI session for code ${user_code}.`
                : "Open this page from the device-login URL shown by the CLI."}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <p className="rounded-lg bg-accent p-4 text-sm leading-6 text-accent-foreground">
            Only approve a login you started. Compare the code below with the
            one in your terminal before continuing.
          </p>

          {user_code ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/80">
              <p className="section-label">User code</p>
              <p className="mt-2 font-mono text-lg tracking-[0.2em] text-zinc-950 dark:text-zinc-50">
                {user_code}
              </p>
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
                <Input
                  id="device-label"
                  onChange={(event) => setLabel(event.target.value)}
                  value={label}
                />
              </div>
              <Button
                disabled={!user_code}
                onClick={handleApprove}
                type="button"
              >
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
