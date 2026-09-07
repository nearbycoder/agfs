import { useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Field, platform, useAction, useData, selectClass } from "./shared";
import { starterTemplates, renderFileTemplate } from "~/lib/template-format";
import { saveBrowserText } from "~/lib/browser-text";
type Template = {
  id: string;
  name: string;
  body: string;
  contentType: string;
  revision?: number;
};
export function FileTemplates() {
  const data = useData("/templates", "templates"),
    action = useAction();
  const [draft, setDraft] = useState<Template>(starterTemplates[0]),
    [baseline, setBaseline] = useState(JSON.stringify(starterTemplates[0])),
    [destination, setDestination] = useState("");
  const dirty = JSON.stringify(draft) !== baseline;
  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm("Discard unsaved template changes?"),
    enableBeforeUnload: dirty,
    disabled: !dirty,
  });
  function choose(next: Template) {
    if (dirty && !window.confirm("Discard unsaved template changes?")) return;
    setDraft(next);
    setBaseline(JSON.stringify(next));
  }
  async function save(copy = false) {
    const result = await platform(
      "/templates" + (draft.revision && !copy ? "/" + draft.id : ""),
      draft.revision && !copy ? "PATCH" : "POST",
      {
        name: draft.name,
        body: draft.body,
        contentType: draft.contentType,
        ...(draft.revision && !copy ? { revision: draft.revision } : {}),
      },
    );
    const next = { ...draft, ...result };
    setDraft(next);
    setBaseline(JSON.stringify(next));
    await data.refresh();
    action.setNotice("Personal template saved.");
  }
  return (
    <section className="space-y-4" aria-label="File templates">
      <p className="text-sm text-zinc-500">
        Start with a built-in template or save up to 50 personal templates per
        workspace. Use {"{{name}}"} for the destination filename without its
        extension and {"{{date}}"} for today in UTC.
      </p>
      {action.error || data.error ? (
        <p role="alert">{action.error || data.error}</p>
      ) : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
      <label className="grid gap-2 text-sm">
        Choose template
        <select
          className={selectClass}
          value={draft.id}
          disabled={action.busy}
          onChange={(e) => {
            const next = [...starterTemplates, ...data.items].find(
              (t) => t.id === e.target.value,
            );
            if (next) choose(next);
          }}
        >
          <optgroup label="Built-in starters">
            {starterTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Your templates">
            {data.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(() => save());
        }}
      >
        <Field
          label="Template name"
          disabled={action.busy}
          required
          maxLength={100}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <label className="grid gap-2 text-sm">
          Template content type
          <select
            className={selectClass}
            disabled={action.busy}
            value={draft.contentType}
            onChange={(e) =>
              setDraft({ ...draft, contentType: e.target.value })
            }
          >
            {[
              "text/plain",
              "text/markdown",
              "application/json",
              "text/csv",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          Template body
          <Textarea
            className="font-mono"
            rows={9}
            disabled={action.busy}
            maxLength={4000}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </label>
        <p className="text-xs text-zinc-500">
          {draft.body.length}/4000 characters
          {dirty ? " · Unsaved template changes" : ""}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button disabled={action.busy}>
            {draft.revision
              ? "Save template changes"
              : "Save personal template"}
          </Button>
          {draft.revision ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={action.busy}
                onClick={() => void action.run(() => save(true))}
              >
                Save a copy under this name
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={action.busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this template? Created files will remain.",
                    )
                  )
                    void action.run(async () => {
                      await platform("/templates/" + draft.id, "DELETE");
                      setDraft(starterTemplates[0]);
                      setBaseline(JSON.stringify(starterTemplates[0]));
                      await data.refresh();
                    });
                }}
              >
                Delete template
              </Button>
            </>
          ) : null}
        </div>
      </form>
      <form
        className="space-y-3 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const text = renderFileTemplate(
              draft.body,
              destination,
              draft.contentType,
            );
            if (draft.contentType === "application/json") {
              try {
                JSON.parse(text);
              } catch {
                throw new Error(
                  "The template does not produce valid JSON. Fix its body before creating the file.",
                );
              }
            }
            await saveBrowserText(destination, text, null, draft.contentType);
            action.setNotice(
              "Created " +
                destination +
                ". Existing files are never overwritten.",
            );
          });
        }}
      >
        <Field
          label="New file destination"
          disabled={action.busy}
          placeholder="/notes/review.md"
          required
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        />
        <details>
          <summary className="cursor-pointer text-sm">
            Preview rendered file
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
            {renderFileTemplate(draft.body, destination, draft.contentType)}
          </pre>
        </details>
        <Button disabled={action.busy}>Create file from template</Button>
      </form>
    </section>
  );
}
