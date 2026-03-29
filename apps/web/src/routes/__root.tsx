import type { ReactNode } from "react";
/// <reference types="vite/client" />
import { HeadContent, Link, Outlet, Scripts, createRootRoute, useLocation } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { ArrowUpRight, Folder, TerminalSquare } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { themeScript } from "~/lib/theme";
import { Button } from "~/components/ui/button";
import { ThemeToggle } from "~/components/ThemeToggle";
import { cn } from "~/lib/utils";
import appCss from "~/styles/app.css?url";
import { DefaultCatchBoundary } from "~/components/DefaultCatchBoundary";
import { NotFound } from "~/components/NotFound";
import { DEFAULT_DESCRIPTION, SITE_NAME, SITE_TITLE, buildSeoHead, siteHeadLinks } from "~/lib/seo";

export const Route = createRootRoute({
  head: () => {
    const seo = buildSeoHead({
      title: SITE_TITLE,
      description: DEFAULT_DESCRIPTION,
    });

    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "application-name", content: SITE_NAME },
        { name: "apple-mobile-web-app-title", content: SITE_NAME },
        { name: "theme-color", content: "#10131a" },
        { name: "color-scheme", content: "light dark" },
        ...seo.meta,
      ],
      links: [{ rel: "stylesheet", href: appCss }, ...siteHeadLinks],
    };
  },
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: () => <NotFound />,
  shellComponent: RootDocument,
});

function RootDocument(props: { children: ReactNode }) {
  const location = useLocation();
  const session = authClient.useSession();
  const navItems = [
    { href: "/", label: "Home" },
    { href: "/cli", label: "CLI" },
    { href: "/app/files", label: "App" },
  ];

  async function handleSignIn() {
    await authClient.signIn.social({
      provider: "github",
      callbackURL: "/app/files",
    });
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        <div className="relative min-h-screen">
          <div className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[28rem] bg-[radial-gradient(circle_at_top,_rgba(24,24,27,0.06),_transparent_60%)] dark:bg-[radial-gradient(circle_at_top,_rgba(244,244,245,0.08),_transparent_60%)]" />
          <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/78 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/75">
            <div className="page-shell flex h-16 items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <Link className="flex items-center gap-3" to="/">
                  <div className="flex size-9 items-center justify-center rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950/80">
                    <Folder className="size-4 text-zinc-900 dark:text-zinc-100" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">agfs.dev</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">AgentFilesystem</p>
                  </div>
                </Link>
                <nav className="hidden items-center gap-1 rounded-full border border-zinc-200 bg-white/80 p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/80 md:flex">
                  {navItems.map((item) => {
                    const isActive = item.href === "/" ? location.pathname === item.href : location.pathname.startsWith(item.href);

                    return (
                      <Link
                        activeOptions={{ exact: item.href === "/" }}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-sm font-medium text-zinc-500 transition-colors dark:text-zinc-400",
                          isActive && "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950",
                        )}
                        key={item.href}
                        to={item.href}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </div>

              <div className="flex items-center gap-2">
                <ThemeToggle />
                {session.data?.user ? (
                  <Button asChild size="sm" variant="outline">
                    <Link to="/app/files">
                      Open workspace
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </Button>
                ) : (
                  <Button onClick={handleSignIn} size="sm" type="button">
                    Connect GitHub
                  </Button>
                )}
                <Button asChild className="hidden sm:inline-flex" size="sm" variant="ghost">
                  <Link to="/cli">
                    <TerminalSquare className="size-4" />
                    CLI
                  </Link>
                </Button>
              </div>
            </div>
          </header>

          <div className={cn("relative z-10", location.pathname.startsWith("/app") ? "py-8 sm:py-10" : "py-10 sm:py-14")}>
            {props.children}
          </div>

          {!location.pathname.startsWith("/app") ? (
            <footer className="page-shell pb-10">
              <div className="flex flex-col gap-3 border-t border-zinc-200/80 pt-6 text-sm text-zinc-500 dark:border-zinc-800/80 dark:text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
                <p>Private files for agents. Fast previews for humans. One control plane.</p>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">Cloudflare Workers + R2 + D1</p>
              </div>
            </footer>
          ) : null}
        </div>
        <TanStackRouterDevtools position="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}
