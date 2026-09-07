// @ts-nocheck
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  FolderKanban,
  Link2,
  ShieldCheck,
  GitCompare,
  Check,
  ArrowUpRight,
} from "lucide-react";
import { FaGithub } from "react-icons/fa6";
import { authClient } from "~/lib/auth-client";
import { CodeWindow } from "~/components/CodeWindow";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatBytes, formatMonthlyPrice } from "~/lib/format";
import { buildSeoHead, buildStructuredDataMeta } from "~/lib/seo";
import { ORDERED_STORAGE_PLANS } from "~/lib/storage-plans";

const HOME_DESCRIPTION =
  "AGFS is a Cloudflare-native filesystem for screenshots, logs, and artifacts created by AI agents. Browse in the web app, automate with the CLI, and share expiring download links.";

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
      screenshot: "https://agfs.dev/workspace-preview.png",
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

  const actionLabel = session.data?.user
    ? "Open workspace"
    : "Sign in with GitHub";

  return (
    <main className="page-shell">
      <section className="grid items-center gap-10 pb-14 pt-16 sm:pt-24 lg:grid-cols-[1.15fr_.85fr] lg:gap-16 lg:pb-20">
        <div>
          <p className="marketing-kicker">
            <span className="size-1.5 rounded-full bg-primary" /> The filesystem
            for your agents
          </p>
          <h1 className="hero-title">
            Good work deserves
            <br />
            <span className="text-primary">a place to land.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            Screenshots, logs, and everything in between. Give your agents a
            private filesystem, and yourself a clear view of what they create.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {session.data?.user ? (
              <Button asChild size="lg">
                <Link to="/app/files">
                  Open workspace
                  <ArrowRight />
                </Link>
              </Button>
            ) : (
              <Button size="lg" onClick={handleSignIn}>
                <FaGithub />
                Start with GitHub
                <ArrowRight />
              </Button>
            )}
            <Button asChild size="lg" variant="outline">
              <Link to="/cli">Explore the CLI</Link>
            </Button>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            1 GB free storage · Open source · Built for humans and agents
          </p>
        </div>
        <div className="min-w-0 lg:pt-8">
          <CodeWindow title="From agent to workspace">{`# Give your work a home
agfs upload ./report.md /runs/report.md

# Share it when it's ready
agfs upload ./report.md /runs/report.md --share 1h`}</CodeWindow>
          <div className="mt-5 flex items-start gap-3 px-1">
            <span className="mt-0.5 rounded-md bg-accent p-1.5 text-primary">
              <ShieldCheck className="size-4" />
            </span>
            <p className="text-sm leading-6 text-muted-foreground">
              Private by default. Share on your terms with scoped tokens and
              expiring links.
            </p>
          </div>
        </div>
      </section>
      <section className="pb-16 sm:pb-24" aria-label="Workspace preview">
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="section-label">Your workspace, at a glance</p>
          <Link
            to="/app/files"
            className="flex items-center gap-1 text-xs font-medium text-primary"
          >
            Take a look <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        <div className="product-shot">
          <img
            src="/workspace-preview.png"
            alt="AGFS file workspace with grouped navigation, folder breadcrumbs, artifact files, and file actions. Sample workspace."
            width="1440"
            height="960"
            fetchPriority="high"
            className="w-full"
          />
        </div>
        <p className="mt-3 text-right text-[11px] text-muted-foreground">
          A sample workspace. Your files stay private.
        </p>
      </section>
      <section className="marketing-section">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="marketing-kicker">One shared workspace</p>
            <h2 className="marketing-heading max-w-lg">
              From the first artifact
              <br />
              to the final handoff.
            </h2>
          </div>
          <p className="max-w-md self-end text-base leading-7 text-muted-foreground">
            Your agents work in the terminal. You review in the browser. AGFS
            keeps both connected to the same files.
          </p>
        </div>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {[
            {
              icon: FolderKanban,
              title: "Find your bearings",
              copy: "Browse folders, pin favorites, and organize collections. Search by path, type, size, or date to find the right artifact.",
            },
            {
              icon: GitCompare,
              title: "Understand the output",
              copy: "Edit text, inspect JSON and CSV, compare files, and review agent runs. Keep useful context alongside files with notes.",
            },
            {
              icon: Link2,
              title: "Make the handoff",
              copy: "Create expiring links, scope agent access, and review activity. Recover previous versions when something needs a second look.",
            },
          ].map((item) => (
            <article key={item.title} className="border-t pt-6">
              <item.icon className="mb-6 size-6 text-primary" />
              <h3 className="text-lg font-semibold tracking-tight">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {item.copy}
              </p>
            </article>
          ))}
        </div>
      </section>
      <section className="marketing-section grid gap-10 lg:grid-cols-2">
        <div>
          <p className="marketing-kicker">Works where you work</p>
          <h2 className="marketing-heading">
            A familiar CLI.
            <br />
            An agent-ready connection.
          </h2>
          <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
            Upload from your laptop, a CI job, or a remote agent. Connect an MCP
            client directly, using the permissions you choose.
          </p>
          <Link
            to="/cli"
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary"
          >
            Read the setup guide <ArrowRight className="size-4" />
          </Link>
        </div>
        <CodeWindow title="Install · authenticate · upload">{`npm install -g @agfs/cli
agfs login
agfs upload ./artifact.json /runs/artifact.json

# MCP endpoint
https://agfs.dev/mcp`}</CodeWindow>
      </section>
      <section className="marketing-section">
        <div className="mb-10">
          <p className="marketing-kicker">Room to get started</p>
          <h2 className="marketing-heading">Start small. Keep creating.</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {ORDERED_STORAGE_PLANS.map((plan) => (
            <article
              className="rounded-xl border bg-card p-7 sm:p-9"
              key={plan.id}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{plan.name}</h3>
                <Badge variant={plan.id === "free" ? "success" : "secondary"}>
                  {plan.id === "free" ? "Available now" : "Coming soon"}
                </Badge>
              </div>
              <p className="mt-7 text-4xl font-semibold tracking-tight">
                {plan.priceMonthlyCents == null
                  ? "Free"
                  : formatMonthlyPrice(plan.priceMonthlyCents)}
                {plan.priceMonthlyCents != null ? (
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    / month
                  </span>
                ) : null}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                {formatBytes(plan.storageLimitBytes)} of private file storage
              </p>
              <div className="my-6 space-y-3 border-t pt-6">
                {[
                  "Web workspace, CLI, and MCP",
                  "File tools and expiring share links",
                  "Scoped tokens and activity history",
                ].map((feature) => (
                  <p className="flex items-center gap-2 text-sm" key={feature}>
                    <Check className="size-4 text-primary" />
                    {feature}
                  </p>
                ))}
              </div>
              {plan.id === "free" ? (
                <Button asChild className="w-full" variant="outline">
                  <Link to="/app/files">
                    Open your workspace <ArrowRight />
                  </Link>
                </Button>
              ) : (
                <p className="text-xs leading-6 text-muted-foreground">
                  Self-serve upgrades are not available yet. Paid access is
                  currently enabled manually for selected users.
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
