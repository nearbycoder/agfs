// @ts-nocheck
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, FolderTree, KeyRound, Link2, TerminalSquare } from "lucide-react";
import { CodeWindow } from "~/components/CodeWindow";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { buildSeoHead } from "~/lib/seo";

const CLI_DESCRIPTION =
  "Install the AGFS CLI to upload files, browse remote folders, approve device login, generate download links, and move artifacts between local machines, CI, and remote agents.";

export const Route = createFileRoute("/cli")({
  head: () =>
    buildSeoHead({
      title: "AGFS CLI | Upload, Browse, and Share Agent Files",
      description: CLI_DESCRIPTION,
      path: "/cli",
    }),
  component: CliPage,
});

function CliPage() {
  return (
    <main className="page-shell space-y-8">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
        <Card>
          <CardHeader className="space-y-5">
            <Badge className="w-fit" variant="secondary">
              CLI workflow
            </Badge>
            <div className="space-y-4">
              <h1 className="hero-title text-4xl sm:text-5xl">
                Use AGFS from a laptop, a CI job, or a remote agent host.
              </h1>
              <p className="max-w-xl text-base leading-7 text-zinc-500 dark:text-zinc-400">
                The v1 CLI is a Node package with device auth, token auth, upload/download, folder management, and share
                link generation built on the same `/api/v1` contract as the web app.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/app/files">
                  Open workspace
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/">Back to overview</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: TerminalSquare,
                title: "Device auth",
                copy: "Approve once in the browser and keep moving in the terminal.",
              },
              {
                icon: FolderTree,
                title: "Folder-aware",
                copy: "Upload, move, remove, and recursively download remote trees.",
              },
              { icon: Link2, title: "Share links", copy: "Generate download URLs directly from agent workflows." },
            ].map((item) => (
              <div
                className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
                key={item.title}
              >
                <item.icon className="size-4 text-zinc-700 dark:text-zinc-300" />
                <p className="mt-3 text-sm font-semibold text-zinc-950 dark:text-zinc-50">{item.title}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{item.copy}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <CodeWindow title="Install and connect">
          {`npm install -g @agfs/cli
agfs login
agfs whoami

# if you're scripting:
export AGFS_BASE_URL=https://agfs.dev
export AGFS_TOKEN=agfs_pat_...`}
        </CodeWindow>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Badge className="w-fit" variant="secondary">
              MCP
            </Badge>
            <CardTitle>Connect an agent directly.</CardTitle>
            <CardDescription>
              Use https://agfs.dev/mcp with a scoped AGFS bearer token. The endpoint supports the July 2026 stateless
              protocol and older Streamable HTTP clients.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link className="underline" to="/app/tokens">
              Create a scoped token
            </Link>
            <p className="section-copy mt-3">
              Give the token only the folders and permissions your agent needs. New tokens expire in 30 days by default.
            </p>
          </CardContent>
        </Card>
        <CodeWindow title="Recovery and resumable uploads (CLI from this repo)">{`agfs upload ./artifact.zip /project/artifact.zip
# Repeat the upload command to resume within 24 hours.
agfs versions /project/artifact.zip
agfs trash /project
agfs restore <id> /project/restored.zip
agfs preview /project/log.txt
agfs activity`}</CodeWindow>
        <CodeWindow title="Core commands">
          {`agfs ls /
agfs tree /screenshots
agfs mkdir /sessions/run-42
agfs upload ./shot.png /sessions/run-42/shot.png --share 1h
agfs download /sessions/run-42 ./run-42
agfs rm /sessions/run-42 --recursive`}
        </CodeWindow>

        <Card>
          <CardHeader>
            <Badge className="w-fit" variant="secondary">
              Designed for automation
            </Badge>
            <CardTitle>Readable output for humans, stable behavior for agents.</CardTitle>
            <CardDescription>
              The CLI mirrors the web app contract, so uploads, shares, device auth, and token auth all stay in one
              mental model.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="section-label">Install</p>
              <p className="mt-2 font-mono text-sm text-zinc-700 dark:text-zinc-200">npm install -g @agfs/cli</p>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="section-label">Authenticate</p>
              <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                Use `agfs login` for device flow, or pass a long-lived agent token through `AGFS_TOKEN` in headless
                environments.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="section-label">Generate download links</p>
              <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                `agfs upload ./shot.png /shots/shot.png --share 15m` prints the download URL directly in the terminal.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <KeyRound className="size-4" />
              Tokens created in the app appear immediately in CLI auth flows.
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
