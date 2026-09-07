// @ts-nocheck
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  FolderTree,
  KeyRound,
  Link2,
  TerminalSquare,
} from "lucide-react";
import { CodeWindow } from "~/components/CodeWindow";
import { Button } from "~/components/ui/button";
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
    <main className="page-shell py-12 sm:py-20">
      <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-26 lg:h-fit">
          <p className="section-label mb-4">Getting started</p>
          <nav
            aria-label="Documentation sections"
            className="flex flex-wrap gap-2 lg:flex-col"
          >
            {[
              ["install", "Install & connect"],
              ["files", "Working with files"],
              ["mcp", "Connect via MCP"],
              ["recovery", "Recover your work"],
              ["automation", "Automation"],
            ].map(([id, label]) => (
              <a key={id} className="workspace-link" href={"#" + id}>
                {label}
              </a>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 space-y-14">
          <header>
            <p className="marketing-kicker">CLI & MCP</p>
            <h1 className="hero-title text-4xl sm:text-5xl">
              Your files. Your workflow.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
              Connect your laptop, CI job, or agent to the same private
              workspace. Start with the CLI, or connect an MCP client directly.
            </p>
          </header>
          <section id="install" className="space-y-5">
            <div>
              <p className="section-label mb-2">01 / Set up</p>
              <h2 className="text-2xl font-semibold tracking-tight">
                Install and connect
              </h2>
              <p className="section-copy mt-3">
                Install the Node package, then approve device login in your
                browser. Run whoami to confirm the connected account.
              </p>
            </div>
            <CodeWindow title="Terminal">{`npm install -g @agfs/cli
agfs login
agfs whoami`}</CodeWindow>
          </section>
          <section id="files" className="space-y-5">
            <div>
              <p className="section-label mb-2">02 / Create & share</p>
              <h2 className="text-2xl font-semibold tracking-tight">
                Work with familiar commands
              </h2>
              <p className="section-copy mt-3">
                Browse directories, upload artifacts, and download a whole
                folder. Add --share to return an expiring download link.
              </p>
            </div>
            <CodeWindow title="File commands">{`agfs ls /
agfs tree /screenshots
agfs mkdir /sessions/run-42
agfs upload ./shot.png /sessions/run-42/shot.png --share 1h
agfs download /sessions/run-42 ./run-42
agfs rm /sessions/run-42 --recursive`}</CodeWindow>
          </section>
          <section id="mcp" className="rounded-xl border bg-card p-6 sm:p-8">
            <p className="section-label mb-2">03 / Connect an agent</p>
            <h2 className="text-2xl font-semibold tracking-tight">
              Use AGFS over MCP
            </h2>
            <p className="section-copy mt-3">
              Add the endpoint below to your MCP client with a scoped AGFS
              bearer token. AGFS supports the July 2026 stateless protocol and
              older Streamable HTTP clients.
            </p>
            <div className="my-6 overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-sm">
              https://agfs.dev/mcp
            </div>
            <p className="section-copy">
              Give each token only the folders and permissions it needs. New
              tokens expire in 30 days by default.
            </p>
            <Button asChild className="mt-5" variant="outline">
              <Link to="/app/tokens">
                <KeyRound />
                Create a scoped token
                <ArrowRight />
              </Link>
            </Button>
          </section>
          <section id="recovery" className="space-y-5">
            <div>
              <p className="section-label mb-2">
                04 / Pick up where you left off
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">
                Resume uploads. Recover files.
              </h2>
              <p className="section-copy mt-3">
                Repeat an upload command within 24 hours to resume. Browse
                retained versions and trash before restoring a file.
              </p>
            </div>
            <CodeWindow title="Recovery">{`agfs upload ./artifact.zip /project/artifact.zip
agfs versions /project/artifact.zip
agfs trash /project
agfs restore <id> /project/restored.zip
agfs preview /project/log.txt
agfs activity`}</CodeWindow>
          </section>
          <section id="automation" className="space-y-5">
            <div>
              <p className="section-label mb-2">05 / Run headlessly</p>
              <h2 className="text-2xl font-semibold tracking-tight">
                Connect your automation
              </h2>
              <p className="section-copy mt-3">
                Use an agent token in your environment when a browser is
                unavailable. Keep the token in your environment's secret store.
              </p>
            </div>
            <CodeWindow title="Environment">{`export AGFS_BASE_URL=https://agfs.dev
export AGFS_TOKEN=agfs_pat_...`}</CodeWindow>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/app/files">
                  Open workspace
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a
                  href="https://github.com/nearbycoder/agfs"
                  target="_blank"
                  rel="noreferrer"
                >
                  Browse the source ↗
                </a>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
