import { Link } from "@tanstack/react-router";
import { FolderOpen, Search, FilePenLine, ArrowUpRight } from "lucide-react";
import { FileLink } from "~/components/ui/file-link";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { RecentFiles } from "./RecentFiles";
import { useState } from "react";
import { Collections } from "./Collections";
import { Button } from "~/components/ui/button";
import { Page, Field, Empty, platform, useAction, useData } from "./shared";
export function LibraryPage() {
  const [path, setPath] = useState("");
  const favorites = useData("/favorites", "favorites"),
    action = useAction();
  return (
    <Page
      title="Library"
      description="Your favorites in this workspace. Favorites follow files when they move and disappear when the file is deleted."
      error={action.error || favorites.error}
      notice={action.notice}
    >
      <nav
        aria-label="Start from your library"
        className="grid gap-3 lg:grid-cols-3"
      >
        {[
          {
            to: "/app/files",
            title: "Browse files",
            copy: "Pick up where you left off",
            icon: FolderOpen,
          },
          {
            to: "/app/search",
            title: "Find an artifact",
            copy: "Search names, text, and tags",
            icon: Search,
          },
          {
            to: "/app/tools",
            title: "Open the workbench",
            copy: "Inspect, edit, and compare",
            icon: FilePenLine,
          },
        ].map((item) => (
          <Link key={item.to} to={item.to} className="workspace-launcher">
            <item.icon className="size-5 shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-sm font-semibold">{item.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {item.copy}
              </span>
            </span>
            <ArrowUpRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </nav>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Favorites</h2>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
          {favorites.items.length} pinned
        </span>
      </div>
      <Disclosure>
        <DisclosureSummary>
          <span>
            <span className="block font-semibold">Add a favorite</span>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Pin a file or folder for quick access.
            </span>
          </span>
        </DisclosureSummary>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await platform("/favorites", "PUT", { path });
              setPath("");
              await favorites.refresh();
              action.setNotice("Favorite added.");
            });
          }}
        >
          <Field
            label="File or folder path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/reports"
            required
          />
          <Button disabled={action.busy}>Add favorite</Button>
        </form>
      </Disclosure>
      <ul className="divide-y">
        {favorites.items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <FileLink path={item.path} kind={item.kind} />
            <Button
              variant="outline"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await platform("/favorites", "DELETE", { path: item.path });
                  await favorites.refresh();
                })
              }
            >
              Remove favorite
            </Button>
          </li>
        ))}
      </ul>
      {!favorites.items.length ? (
        <Empty
          loading={favorites.loading}
          text="Add a favorite to keep important files and folders close."
        />
      ) : null}
      <RecentFiles />
      <Collections />
    </Page>
  );
}
