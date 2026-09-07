/// <reference types="vite/client" />
import { Brand } from "~/components/Brand";
import type { ReactNode } from "react";
import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
  useLocation,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { ArrowUpRight } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { themeScript } from "~/lib/theme";
import { Button } from "~/components/ui/button";
import { ThemeToggle } from "~/components/ThemeToggle";
import appCss from "~/styles/app.css?url";
import { DefaultCatchBoundary } from "~/components/DefaultCatchBoundary";
import { NotFound } from "~/components/NotFound";
import {
  DEFAULT_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  buildSeoHead,
  siteHeadLinks,
} from "~/lib/seo";

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

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <div className="min-h-screen">
          {!location.pathname.startsWith("/app") ? (
            <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
              <div className="page-shell flex h-18 items-center justify-between gap-3">
                <Brand />
                <nav
                  aria-label="Main navigation"
                  className="hidden items-center gap-5 whitespace-nowrap sm:flex text-xs sm:text-sm font-medium text-muted-foreground"
                >
                  <Link
                    to="/"
                    activeOptions={{ exact: true }}
                    activeProps={{ className: "text-primary" }}
                    className="hidden sm:inline"
                  >
                    Overview
                  </Link>
                  <Link to="/cli" activeProps={{ className: "text-primary" }}>
                    CLI & MCP
                  </Link>
                  <a
                    className="hidden md:inline"
                    href="https://github.com/nearbycoder/agfs"
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub ↗
                  </a>
                </nav>
                <div className="flex items-center gap-2">
                  <ThemeToggle />
                  <Button asChild size="sm">
                    <Link to="/app/files">
                      {session.data?.user ? "Workspace" : "Get started"}
                      <ArrowUpRight />
                    </Link>
                  </Button>
                </div>
              </div>
            </header>
          ) : null}
          <div
            id={
              !location.pathname.startsWith("/app") ? "main-content" : undefined
            }
            tabIndex={!location.pathname.startsWith("/app") ? -1 : undefined}
          >
            {props.children}
          </div>
          {!location.pathname.startsWith("/app") ? (
            <footer className="border-t">
              <div className="page-shell flex flex-wrap items-center justify-between gap-6 py-9">
                <div>
                  <Brand />
                  <p className="mt-3 text-xs text-muted-foreground">
                    A home for the work your agents create.
                  </p>
                </div>
                <div className="flex gap-6 text-sm text-muted-foreground">
                  <Link to="/cli">Documentation</Link>
                  <a
                    href="https://github.com/nearbycoder/agfs"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Source code ↗
                  </a>
                </div>
              </div>
            </footer>
          ) : null}
        </div>
        {import.meta.env.DEV ? (
          <TanStackRouterDevtools position="bottom-right" />
        ) : null}
        <Scripts />
      </body>
    </html>
  );
}
