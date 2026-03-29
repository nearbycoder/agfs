// @ts-nocheck
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authClient } from "~/lib/auth-client";

export const Route = createFileRoute("/device")({
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
    <main className="device-page">
      <section className="panel device-card">
        <p className="eyebrow">CLI approval</p>
        <h1>Approve a waiting AGFS device login.</h1>
        <p>
          {user_code
            ? `Approve the CLI session for code ${user_code}.`
            : "Open this page from the device-login URL shown by the CLI."}
        </p>
        {!session.data?.user ? (
          <button className="button button-primary" onClick={handleSignIn} type="button">
            Sign in with GitHub
          </button>
        ) : (
          <div className="panel-stack compact">
            <input onChange={(event) => setLabel(event.target.value)} value={label} />
            <button className="button button-primary" disabled={!user_code} onClick={handleApprove} type="button">
              Approve device
            </button>
          </div>
        )}
        {status ? <p className="success-note">{status}</p> : null}
        {error ? <p className="error-note">{error}</p> : null}
      </section>
    </main>
  );
}
