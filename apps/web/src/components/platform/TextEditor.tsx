import { TextCleanup } from "./TextCleanup";
import { EditorNavigation } from "./EditorNavigation";
import { TextReplace } from "./TextReplace";
import { useBlocker } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Field, platform, useAction } from "./shared";
import { saveBrowserText } from "~/lib/browser-text";
type Document = {
  path: string;
  text: string;
  etag: string | null;
  contentType: string;
  canEdit: boolean;
  isNew?: boolean;
};
export function TextEditor() {
  const [path, setPath] = useState(""),
    [document, setDocument] = useState<Document | null>(null),
    [text, setText] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const [wrap, setWrap] = useState(true);
  const action = useAction();
  const dirty = !!document && (text !== document.text || !!document.isNew);
  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm("Discard unsaved edits and leave this page?"),
    enableBeforeUnload: dirty,
    disabled: !dirty,
  });
  function discard() {
    return !dirty || window.confirm("Discard unsaved text edits?");
  }
  return (
    <section className="space-y-4" aria-label="Text editor">
      <p className="text-sm text-muted-foreground">
        Edit UTF-8 files up to 256 KiB. Saves keep the previous version in
        recovery and reject concurrent changes.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!discard()) return;
          void action.run(async () => {
            const d = await platform("/text?path=" + encodeURIComponent(path));
            setDocument(d);
            setText(d.text);
          });
        }}
      >
        <Field
          label="Text file path"
          required
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button disabled={action.busy}>Open text file</Button>
        <Button
          type="button"
          variant="outline"
          disabled={action.busy || !path.startsWith("/") || path === "/"}
          onClick={() => {
            if (discard()) {
              setDocument({
                path,
                text: "",
                etag: null,
                contentType: "text/plain",
                canEdit: true,
                isNew: true,
              });
              setText("");
            }
          }}
        >
          New text file
        </Button>
      </form>
      {action.error ? (
        <p role="alert" className="text-red-600">
          {action.error} Your current edits have been kept.
        </p>
      ) : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
      {document ? (
        <div className="space-y-3">
          <h2 className="font-mono break-all">
            {document.path}
            {document.isNew ? " (new)" : ""}
          </h2>
          <TextReplace
            key={document.path + (document.etag ?? "new")}
            value={text}
            onChange={setText}
            disabled={!document.canEdit || action.busy}
          />
          <TextCleanup
            key={document.path + (document.etag ?? "new")}
            value={text}
            onChange={setText}
            disabled={!document.canEdit || action.busy}
          />
          <EditorNavigation
            editor={editor}
            value={text}
            wrap={wrap}
            onWrap={setWrap}
          />
          <label className="grid gap-2 text-sm">
            File contents
            <Textarea
              ref={editor}
              wrap={wrap ? "soft" : "off"}
              className="font-mono text-sm"
              rows={18}
              value={text}
              readOnly={!document.canEdit || action.busy}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {new TextEncoder().encode(text).length.toLocaleString()} / 262,144
            bytes · {text.split("\n").length} lines
            {dirty ? " · Unsaved edits" : ""}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={!document.canEdit || action.busy || !dirty}
              onClick={() =>
                void action.run(async () => {
                  const result = await saveBrowserText(
                    document.path,
                    text,
                    document.etag,
                    document.contentType,
                  );
                  setDocument({
                    ...document,
                    text,
                    etag: result.entry.etag,
                    isNew: false,
                  });
                  action.setNotice("File saved.");
                })
              }
            >
              Save file
            </Button>
            <Button
              variant="outline"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await navigator.clipboard.writeText(text);
                  action.setNotice("Current text copied.");
                })
              }
            >
              Copy current text
            </Button>
          </div>
          {!document.canEdit ? (
            <p className="text-sm">You have read-only access to this file.</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Open a file or start a new one. New files never replace an existing
          path.
        </p>
      )}
    </section>
  );
}
