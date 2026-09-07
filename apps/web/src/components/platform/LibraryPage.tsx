import { useState } from "react";
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
      <ul className="divide-y">
        {favorites.items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <a
              className="font-mono text-sm underline break-all"
              href={
                item.kind === "folder"
                  ? "/app/files?path=" + encodeURIComponent(item.path)
                  : "/api/v1/fs/download?path=" + encodeURIComponent(item.path)
              }
            >
              {item.path}
            </a>
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
    </Page>
  );
}
