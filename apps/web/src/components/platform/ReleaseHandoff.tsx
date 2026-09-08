import { useMemo, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Field, useAction } from "./shared";
import { releaseHandoff, type HandoffArtifact } from "~/lib/release-handoff";
import { downloadText } from "~/lib/download-text";
import { saveBrowserText } from "~/lib/browser-text";
export function ReleaseHandoff({
  entries,
  onSaved,
}: {
  entries: HandoffArtifact[];
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState("Release handoff"),
    [notes, setNotes] = useState(""),
    [annotations, setAnnotations] = useState<Record<string, string>>({}),
    [destination, setDestination] = useState("/release-handoff.md"),
    [dirty, setDirty] = useState(false);
  const action = useAction();
  useBlocker({
    shouldBlockFn: () =>
      dirty &&
      !window.confirm("Discard unsaved handoff notes and leave this page?"),
    enableBeforeUnload: dirty,
    disabled: !dirty,
  });
  const result = useMemo(() => {
    try {
      return {
        text: releaseHandoff(title, notes, entries, annotations),
        error: "",
      };
    } catch (e) {
      return {
        text: "",
        error: e instanceof Error ? e.message : "Cannot build handoff",
      };
    }
  }, [title, notes, entries, annotations]);
  if (!entries.length)
    return (
      <Disclosure id="release-handoff">
        <DisclosureSummary>Release handoff</DisclosureSummary>
        <p className="text-sm text-muted-foreground">
          Select files in the directory table to assemble a handoff. Notes in
          this tab are retained while you change your selection.
        </p>
      </Disclosure>
    );
  return (
    <Disclosure id="release-handoff">
      <DisclosureSummary>
        Release handoff · {entries.length} artifacts
      </DisclosureSummary>
      <p className="text-sm text-muted-foreground">
        Build a Markdown handoff from up to 50 selected files. Include release
        context and notes for each artifact, then download or save a new file.
        Artifact paths stay private; no share links are created.
      </p>
      <Field
        label="Handoff title"
        maxLength={120}
        value={title}
        disabled={action.busy}
        onChange={(e) => {
          setTitle(e.target.value);
          setDirty(true);
        }}
      />
      <label className="grid gap-2 text-sm">
        Release context
        <Textarea
          value={notes}
          maxLength={8000}
          disabled={action.busy}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
        />
      </label>
      {entries.length <= 50 ? (
        <div className="grid gap-3">
          {entries.map((file) => (
            <label
              key={file.path}
              className="grid gap-2 rounded-lg border p-3 text-sm"
            >
              <span className="break-all font-mono">Notes for {file.path}</span>
              <Textarea
                rows={2}
                maxLength={2000}
                disabled={action.busy}
                value={annotations[file.path] ?? ""}
                onChange={(e) => {
                  setAnnotations((old) => ({
                    ...old,
                    [file.path]: e.target.value,
                  }));
                  setDirty(true);
                }}
              />
            </label>
          ))}
        </div>
      ) : null}
      <Disclosure>
        <DisclosureSummary>Handoff Markdown preview</DisclosureSummary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
          {result.text.slice(0, 16000)}
        </pre>
        <p className="text-xs text-muted-foreground">
          First 16,000 characters shown. Download and save include the complete
          handoff.
        </p>
      </Disclosure>
      <Button
        variant="outline"
        disabled={!!result.error || action.busy}
        onClick={() => {
          downloadText("release-handoff.md", result.text, "text/markdown");
          setDirty(false);
        }}
      >
        Download handoff
      </Button>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await saveBrowserText(
              destination,
              result.text,
              null,
              "text/markdown",
            );
            setDirty(false);
            action.setNotice("New handoff saved to " + destination);
            await onSaved();
          });
        }}
      >
        <Field
          label="New handoff file path"
          required
          value={destination}
          disabled={action.busy}
          onChange={(e) => setDestination(e.target.value)}
        />
        <Button disabled={!!result.error || action.busy}>
          Save new handoff
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Saving uses create-only checks and fails if the destination already
        exists. Notes are kept in this tab until downloaded or saved.
      </p>
      {result.error || action.error ? (
        <p role="alert">{result.error || action.error}</p>
      ) : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
    </Disclosure>
  );
}
