import { Brand } from "./Brand";
import { Link, useLocation } from "@tanstack/react-router";
import { FaGithub } from "react-icons/fa6";
import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function AuthGate(props: { children: ReactNode; message?: string }) {
  const session = authClient.useSession();
  const inApp = useLocation().pathname.startsWith("/app");

  if (session.isPending) {
    return (
      <main
        id={inApp ? "main-content" : undefined}
        tabIndex={-1}
        className="status-shell"
      >
        <Card className="max-w-md">
          <CardHeader>
            <Badge className="w-fit" variant="secondary">
              Authenticating
            </Badge>
            <CardTitle className="flex items-center gap-3">
              <LoaderCircle className="size-5 animate-spin text-zinc-500 dark:text-zinc-400" />
              Checking your session
            </CardTitle>
            <CardDescription>
              We’re verifying your GitHub session before opening the workspace.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (!session.data?.user) {
    return (
      <main
        id={inApp ? "main-content" : undefined}
        tabIndex={-1}
        className="status-shell"
      >
        <Card className="w-full max-w-md p-3 sm:p-5">
          <CardHeader>
            <div className="mb-8">
              <Brand />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome to your workspace
            </h1>
            <CardDescription>
              {props.message ??
                "Your files, agent runs, and shared work. Sign in with GitHub to pick up where you left off."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              size="lg"
              onClick={() =>
                authClient.signIn.social({
                  provider: "github",
                  callbackURL:
                    window.location.pathname + window.location.search,
                })
              }
              type="button"
            >
              <FaGithub /> Sign in with GitHub
            </Button>
            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              New here? Your personal workspace is created when you sign in.
            </p>
            <div className="mt-8 border-t pt-5 text-center">
              <Link
                to="/"
                className="text-sm text-muted-foreground hover:text-primary"
              >
                ← Back to AGFS
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return <>{props.children}</>;
}
