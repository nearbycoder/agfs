import type { ReactNode } from "react";
/// <reference types="vite/client" />
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import appCss from "~/styles/app.css?url";
import { DefaultCatchBoundary } from "~/components/DefaultCatchBoundary";
import { NotFound } from "~/components/NotFound";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "agfs.dev | AgentFilesystem" },
      {
        name: "description",
        content: "Private Cloudflare-native file storage for humans and AI agents.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: () => <NotFound />,
  shellComponent: RootDocument,
});

function RootDocument(props: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header className="site-header">
          <Link className="brandmark" to="/">
            <span>AGFS</span>
            <small>AgentFilesystem</small>
          </Link>
          <nav className="site-nav">
            <Link activeOptions={{ exact: true }} to="/">
              Home
            </Link>
            <Link to="/cli">CLI</Link>
            <Link to="/app/files">App</Link>
          </nav>
        </header>
        {props.children}
        <TanStackRouterDevtools position="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}
