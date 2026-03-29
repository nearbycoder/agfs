import type { ReactNode } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

export function AuthGate(props: { children: ReactNode; message?: string }) {
  const session = authClient.useSession();

  if (session.isPending) {
    return (
      <div className="status-shell">
        <Card className="max-w-md">
          <CardHeader>
            <Badge className="w-fit" variant="secondary">
              Authenticating
            </Badge>
            <CardTitle className="flex items-center gap-3">
              <LoaderCircle className="size-5 animate-spin text-zinc-500 dark:text-zinc-400" />
              Checking your session
            </CardTitle>
            <CardDescription>We’re verifying your GitHub session before opening the workspace.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!session.data?.user) {
    return (
      <div className="status-shell">
        <Card className="max-w-xl">
          <CardHeader>
            <Badge className="w-fit" variant="secondary">
              Sign in required
            </Badge>
            <CardTitle className="flex items-center gap-3">
              <LockKeyhole className="size-5 text-zinc-500 dark:text-zinc-400" />
              Connect GitHub to open your AGFS workspace
            </CardTitle>
            <CardDescription>{props.message ?? "Private files, tokens, and shares live behind your AGFS session."}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() =>
                authClient.signIn.social({
                  provider: "github",
                  callbackURL: "/app/files",
                })
              }
              type="button"
            >
              Sign in with GitHub
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{props.children}</>;
}
