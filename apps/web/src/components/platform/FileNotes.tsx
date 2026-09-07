import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Field, platform, useAction } from "./shared";
type Note = {
  body: string;
  revision: number;
  updatedAt: number;
  author: string;
};
type Loaded = {
  entry: { id: string; path: string };
  canEdit: boolean;
  note: Note | null;
};
export function FileNotes({ initialPath = "" }: { initialPath?: string }) {
  const [path, setPath] = useState(initialPath),
    [loaded, setLoaded] = useState<Loaded | null>(null),
    [body, setBody] = useState("");
  const action = useAction(),
    dirty = !!loaded && body !== (loaded.note?.body ?? "");
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return (
    <section className="space-y-4" aria-label="File notes">
      <p className="text-sm text-zinc-500">
        Notes are shared with everyone who can read the file in this workspace.
        Editors can update them.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            dirty &&
            !window.confirm("Discard unsaved note edits and reload?")
          )
            return;
          void action.run(async () => {
            const data = await platform(
              "/notes?path=" + encodeURIComponent(path),
            );
            setLoaded(data);
            setBody(data.note?.body ?? "");
          });
        }}
      >
        <Field
          label="File or folder path"
          required
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button disabled={action.busy}>Load notes</Button>
      </form>
      {action.error ? (
        <p role="alert" className="text-red-600">
          {action.error}
        </p>
      ) : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
      {loaded ? (
        <div className="space-y-3 rounded-xl border p-4">
          <h2 className="font-mono break-all">Notes for {loaded.entry.path}</h2>
          <label className="grid gap-2 text-sm">
            Notes
            <Textarea
              rows={8}
              maxLength={4000}
              value={body}
              readOnly={!loaded.canEdit}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <p className="text-xs text-zinc-500">
            {body.length}/4000 characters ·{" "}
            {loaded.note
              ? `Updated ${new Date(loaded.note.updatedAt).toLocaleString()} · Revision ${loaded.note.revision}`
              : "No notes yet"}
            {dirty ? " · Unsaved edits" : ""}
          </p>
          {loaded.canEdit ? (
            <Button
              disabled={action.busy || !dirty}
              onClick={() =>
                void action.run(async () => {
                  const result = await platform("/notes", "PUT", {
                    path: loaded.entry.path,
                    entryId: loaded.entry.id,
                    revision: loaded.note?.revision ?? 0,
                    body,
                  });
                  setLoaded({ ...loaded, note: result.note });
                  action.setNotice("Notes saved.");
                })
              }
            >
              Save notes
            </Button>
          ) : (
            <p className="text-sm">You have read-only access.</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          Load a file or folder to read or write its notes.
        </p>
      )}
    </section>
  );
}
