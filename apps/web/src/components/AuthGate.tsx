import type { ReactNode } from "react";
import { authClient } from "~/lib/auth-client";

export function AuthGate(props: { children: ReactNode; message?: string }) {
  const session = authClient.useSession();

  if (session.isPending) {
    return (
      <div className="panel">
        <p className="eyebrow">Authenticating</p>
        <h2>Checking your session…</h2>
      </div>
    );
  }

  if (!session.data?.user) {
    return (
      <div className="panel">
        <p className="eyebrow">Sign in required</p>
        <h2>{props.message ?? "Connect GitHub to open your AGFS workspace."}</h2>
        <button
          className="button button-primary"
          onClick={() =>
            authClient.signIn.social({
              provider: "github",
              callbackURL: "/app/files",
            })
          }
          type="button"
        >
          Sign in with GitHub
        </button>
      </div>
    );
  }

  return <>{props.children}</>;
}
