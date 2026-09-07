import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Field,
  Empty,
  platform,
  useAction,
  useData,
  selectClass,
} from "./shared";
type Collection = { id: string; name: string; count: number };
export function Collections() {
  const data = useData("/collections", "collections"),
    action = useAction();
  const [name, setName] = useState(""),
    [selected, setSelected] = useState("");
  const current = data.items.find((c) => c.id === selected) as
    Collection | undefined;
  return (
    <section
      className="space-y-4 rounded-xl border p-4"
      aria-label="Collections"
    >
      <h2 className="font-semibold">Collections</h2>
      <p className="text-sm text-zinc-500">
        Group files and folders without moving or copying them. Collections are
        personal to you in this workspace.
      </p>
      {action.error || data.error ? (
        <p role="alert">{action.error || data.error}</p>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const c = await platform("/collections", "POST", { name });
            await data.refresh();
            setSelected(c.id);
            setName("");
          });
        }}
      >
        <Field
          label="New collection name"
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button disabled={action.busy}>Create collection</Button>
      </form>
      <label className="grid gap-2 text-sm">
        Collection
        <select
          className={selectClass}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose a collection</option>
          {data.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.count})
            </option>
          ))}
        </select>
      </label>
      {!data.items.length ? (
        <Empty
          loading={data.loading}
          text="Create a collection for a project, review, or handoff."
        />
      ) : null}
      {current ? (
        <CollectionDetails
          key={current.id}
          collection={current}
          refresh={() => data.refresh()}
          removed={() => setSelected("")}
        />
      ) : null}
    </section>
  );
}
function CollectionDetails({
  collection,
  refresh,
  removed,
}: {
  collection: Collection;
  refresh: () => Promise<void>;
  removed: () => void;
}) {
  const data = useData("/collections/" + collection.id + "/items", "items"),
    action = useAction();
  const [name, setName] = useState(collection.name),
    [path, setPath] = useState("");
  const endpoint = "/collections/" + collection.id;
  return (
    <div className="space-y-4">
      {action.error || data.error ? (
        <p role="alert">{action.error || data.error}</p>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await platform(endpoint, "PATCH", { name });
            await refresh();
          });
        }}
      >
        <Field
          label="Collection name"
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={action.busy || name === collection.name}
        >
          Rename collection
        </Button>
      </form>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await platform(endpoint + "/items", "PUT", { path });
            setPath("");
            await data.refresh();
            await refresh();
          });
        }}
      >
        <Field
          label="Add file or folder path"
          required
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button disabled={action.busy}>Add to collection</Button>
      </form>
      <ul className="divide-y">
        {data.items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <a
              className="font-mono text-sm underline break-all"
              href={
                (item.kind === "folder"
                  ? "/app/files?path="
                  : "/api/v1/fs/download?path=") + encodeURIComponent(item.path)
              }
            >
              {item.path}
            </a>
            <Button
              variant="ghost"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await platform(endpoint + "/items", "DELETE", {
                    entryId: item.id,
                  });
                  await data.refresh();
                  await refresh();
                })
              }
            >
              Remove from collection
            </Button>
          </li>
        ))}
      </ul>
      {!data.items.length ? (
        <Empty
          loading={data.loading}
          text="This collection is empty. Add an existing file or folder."
        />
      ) : null}
      <Button
        variant="outline"
        disabled={action.busy}
        onClick={() => {
          if (
            window.confirm(
              "Delete this collection? The files themselves will remain.",
            )
          )
            void action.run(async () => {
              await platform(endpoint, "DELETE");
              removed();
              await refresh();
            });
        }}
      >
        Delete collection
      </Button>
    </div>
  );
}
