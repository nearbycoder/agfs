// @ts-nocheck
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, FolderKanban, Link2, Upload } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { CodeWindow } from "~/components/CodeWindow";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatBytes, formatMonthlyPrice } from "~/lib/format";
import { buildSeoHead, buildStructuredDataMeta } from "~/lib/seo";
import { ORDERED_STORAGE_PLANS } from "~/lib/storage-plans";

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

const CONTROL_PLANE_STEPS = [
  {
    label: "Upload",
    description: "Drop screenshots, logs, and artifacts into a private namespace without exposing bucket URLs or ad hoc paths.",
    icon: Upload,
  },
  {
    label: "Browse",
    description: "Open the same account-scoped workspace in the web app when you want fast inspection, organization, and selection.",
    icon: FolderKanban,
  },
  {
    label: "Share",
    description: "Hand back expiring AGFS links that stay on agfs.dev, open inline, and feel like part of the product instead of raw storage.",
    icon: Link2,
  },
];

const CONTROL_PLANE_TAGS = ["Private namespace", "Expiring previews", "CLI + web app"];
const PLAN_MARKETING = {
  free: {
    eyebrow: "Default",
    copy: "Every account starts with a clean 1 GB workspace for artifacts, logs, screenshots, and previews.",
    detail: "Best for personal use, small runs, and trying the full AGFS workflow.",
  },
  paid: {
    eyebrow: "Coming soon",
    copy: "Bump storage to 20 GB for teams, heavier automation, and longer-lived artifact histories.",
    detail: "Stripe billing is on the way. For now, paid access is enabled manually for selected users.",
  },
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

          <Card className="app-preview-card h-full border-white/10 bg-zinc-950 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_24px_80px_rgba(0,0,0,0.46)]">
            <CardHeader className="space-y-4 pb-5">
              <span className="app-preview-chip w-fit">Why it exists</span>
              <div className="space-y-3">
                <CardTitle className="max-w-sm text-xl tracking-[-0.04em] text-zinc-50">
                  Remote agents can create files you can&apos;t directly reach.
                </CardTitle>
                <p className="max-w-md text-sm leading-6 text-zinc-300/78">
                  AGFS keeps the handoff in one darker control plane, using the same visual language as the app: a
                  private namespace, predictable actions, and preview links that feel native instead of improvised.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                {CONTROL_PLANE_STEPS.map((step) => {
                  const Icon = step.icon;

                  return (
                    <div
                      className="rounded-[1.35rem] border border-white/8 bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                      key={step.label}
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                          <Icon className="size-4" />
                        </div>
                        <div className="space-y-1.5">
                          <p className="app-preview-label">{step.label}</p>
                          <p className="text-sm leading-6 text-zinc-300">{step.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {CONTROL_PLANE_TAGS.map((tag) => (
                  <span className="app-preview-chip" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="border-t border-zinc-200/80 pt-8 dark:border-zinc-800/80">
          <div className="space-y-3 text-center">
            <Badge className="w-fit" variant="secondary">
              Pricing
            </Badge>
            <h2 className="text-3xl font-semibold tracking-[-0.05em] text-zinc-950 dark:text-zinc-50">Start free, then unlock more storage.</h2>
            <p className="mx-auto max-w-2xl text-base leading-7 text-zinc-500 dark:text-zinc-400">
              The free plan is the standard today. Paid storage is defined now and will move to Stripe self-serve next.
            </p>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            {ORDERED_STORAGE_PLANS.map((plan) => {
              const marketing = PLAN_MARKETING[plan.id];

              return (
                <Card className={plan.id === "paid" ? "border-zinc-900 bg-zinc-950 text-zinc-50 dark:border-zinc-700" : ""} key={plan.id}>
                  <CardHeader className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant={plan.id === "paid" ? "warning" : "secondary"}>{marketing.eyebrow}</Badge>
                      <p className={plan.id === "paid" ? "text-xs font-medium uppercase tracking-[0.16em] text-zinc-400" : "text-xs font-medium uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500"}>
                        {formatBytes(plan.storageLimitBytes)} included
                      </p>
                    </div>
                    <div className="space-y-2">
                      <CardTitle className={plan.id === "paid" ? "text-zinc-50" : ""}>{plan.name}</CardTitle>
                      <p className={plan.id === "paid" ? "text-4xl font-semibold tracking-[-0.05em] text-zinc-50" : "text-4xl font-semibold tracking-[-0.05em] text-zinc-950 dark:text-zinc-50"}>
                        {plan.priceMonthlyCents == null ? "Free" : `${formatMonthlyPrice(plan.priceMonthlyCents)}/mo`}
                      </p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className={plan.id === "paid" ? "text-sm leading-6 text-zinc-300" : "text-sm leading-6 text-zinc-600 dark:text-zinc-400"}>
                      {marketing.copy}
                    </p>
                    <div className={plan.id === "paid" ? "rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-zinc-300" : "rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400"}>
                      {marketing.detail}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
