import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Field, platform, useAction, useData } from "./shared";
export type SearchFilters = {
  kind?: string;
  minSize?: string;
  maxSize?: string;
  after?: string;
  before?: string;
  q: string;
  path: string;
  type: string;
  tag: string;
};
export function SavedSearches({
  filters,
  onApply,
  busy,
}: {
  filters: SearchFilters;
  onApply: (filters: SearchFilters) => void;
  busy: boolean;
}) {
  const data = useData("/saved-searches", "searches"),
    action = useAction();
  const [name, setName] = useState(""),
    [editing, setEditing] = useState<string | null>(null);
  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      aria-label="Saved searches"
    >
      <h2 className="font-semibold">Saved searches</h2>
      <p className="text-sm text-zinc-500">
        Save the current filters for this workspace. Only you can see them.
      </p>
      {action.error || data.error ? (
        <p role="alert">{action.error || data.error}</p>
      ) : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await platform(
              "/saved-searches" + (editing ? "/" + editing : ""),
              editing ? "PATCH" : "POST",
              editing ? { name } : { name, filters },
            );
            setName("");
            setEditing(null);
            await data.refresh();
            action.setNotice(editing ? "Search renamed." : "Search saved.");
          });
        }}
      >
        <Field
          label={editing ? "Rename saved search" : "Search name"}
          maxLength={100}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button disabled={action.busy || busy}>
          {editing ? "Save name" : "Save current filters"}
        </Button>
        {editing ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditing(null);
              setName("");
            }}
          >
            Cancel rename
          </Button>
        ) : null}
      </form>
      {data.loading ? (
        <p role="status">Loading saved searches…</p>
      ) : !data.items.length ? (
        <p className="text-sm text-zinc-500">No saved searches yet.</p>
      ) : null}
      <ul className="divide-y">
        {data.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 py-2">
            <Button
              variant="outline"
              disabled={busy || action.busy}
              onClick={() => onApply(item.filters)}
            >
              {item.name}
            </Button>
            <span className="text-xs font-mono break-all">
              {item.filters.path}
            </span>
            <Button
              variant="ghost"
              disabled={action.busy}
              onClick={() => {
                setEditing(item.id);
                setName(item.name);
              }}
            >
              Rename {item.name}
            </Button>
            <Button
              variant="ghost"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await platform("/saved-searches/" + item.id, "DELETE");
                  if (editing === item.id) {
                    setEditing(null);
                    setName("");
                  }
                  await data.refresh();
                })
              }
            >
              Delete {item.name}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
