// @ts-nocheck
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { CodeWindow } from "~/components/CodeWindow";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { buildSeoHead, buildStructuredDataMeta } from "~/lib/seo";

const HOME_DESCRIPTION =
  "AGFS is a private Cloudflare-native filesystem for screenshots, logs, and artifacts created by AI agents. Browse in the web app, automate with the CLI, and share expiring preview links.";

const HOME_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://agfs.dev/#website",
      url: "https://agfs.dev",
      name: "AGFS",
      alternateName: "AgentFilesystem",
      description: HOME_DESCRIPTION,
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://agfs.dev/#software",
      name: "AGFS",
      alternateName: "AgentFilesystem",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, macOS, Linux, Windows",
      url: "https://agfs.dev",
      description: HOME_DESCRIPTION,
      image: "https://agfs.dev/og-card.svg",
      screenshot: "https://agfs.dev/og-card.svg",
    },
  ],
};

export const Route = createFileRoute("/")({
  head: () => {
    const seo = buildSeoHead({
      title: "AGFS | Private Filesystem for AI Agents",
      description: HOME_DESCRIPTION,
      path: "/",
    });

    return {
      ...seo,
      meta: [...seo.meta, ...buildStructuredDataMeta(HOME_STRUCTURED_DATA)],
    };
  },
  component: HomePage,
});

function HomePage() {
  const session = authClient.useSession();

  async function handleSignIn() {
    await authClient.signIn.social({
      provider: "github",
      callbackURL: "/app/files",
    });
  }

  const actionLabel = session.data?.user ? "Open workspace" : "Sign in with GitHub";

  return (
    <main className="page-shell py-8 sm:py-12">
      <div className="mx-auto max-w-5xl space-y-12">
        <section className="space-y-6 text-center">
          <Badge className="w-fit" variant="secondary">
            Private storage for agents
          </Badge>

          <div className="mx-auto max-w-3xl space-y-4">
            <h1 className="hero-title">
              A simple place for screenshots, logs, and artifacts your agent can hand back.
            </h1>
            <p className="mx-auto max-w-2xl text-base leading-7 text-zinc-500 dark:text-zinc-400 sm:text-lg">
              AGFS gives every user a private filesystem backed by R2, with a clean web workspace and a CLI that feels
              normal on local machines, CI, and remote agent hosts.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={handleSignIn} size="lg" type="button">
              {actionLabel}
              <ArrowRight className="size-4" />
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link to="/cli">CLI docs</Link>
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
            <span>Account-scoped storage</span>
            <span className="hidden text-zinc-300 dark:text-zinc-700 sm:inline">/</span>
            <span>Signed preview links</span>
            <span className="hidden text-zinc-300 dark:text-zinc-700 sm:inline">/</span>
            <span>GitHub login plus agent tokens</span>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <CodeWindow title="Typical flow">
            {`$ agfs upload ./run/screenshot.png /runs/latest/screenshot.png --share 1h
Uploaded /runs/latest/screenshot.png
Share URL: https://agfs.dev/s/agfssh_4SCQm0...

$ agfs ls /runs/latest
screenshot.png    381 kB    image/png`}
          </CodeWindow>

          <Card className="border-zinc-200/90 bg-white/80 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70">
            <CardHeader className="space-y-3">
              <Badge className="w-fit" variant="outline">
                Why it exists
              </Badge>
              <CardTitle className="text-xl tracking-[-0.03em] text-zinc-950">
                Remote agents can create files you can&apos;t directly reach.
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2 border-t border-zinc-200 pt-4 first:border-t-0 first:pt-0 dark:border-zinc-800">
                <p className="section-label">Upload</p>
                <p className="section-copy">
                  Send screenshots, logs, and artifacts into a private user namespace without exposing raw bucket paths.
                </p>
              </div>
              <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <p className="section-label">Browse</p>
                <p className="section-copy">
                  Open the web app to inspect files and folders, or use the CLI when you want a filesystem-first workflow.
                </p>
              </div>
              <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <p className="section-label">Share</p>
                <p className="section-copy">
                  Generate expiring AGFS links that open inline, so an agent can hand you something clickable immediately.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="border-t border-zinc-200/80 pt-8 dark:border-zinc-800/80">
          <div className="grid gap-8 sm:grid-cols-3">
            <div className="space-y-2">
              <p className="section-label">Preview links</p>
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Signed URLs stay on `agfs.dev`, expire automatically, and render files inline when possible.
              </p>
            </div>
            <div className="space-y-2">
              <p className="section-label">Authentication</p>
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Use GitHub in the browser, device auth in the CLI, or long-lived tokens for unattended agents.
              </p>
            </div>
            <div className="space-y-2">
              <p className="section-label">Storage model</p>
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Metadata lives in D1, bytes live in R2, and each account stays isolated in both places.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
