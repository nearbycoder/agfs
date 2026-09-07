import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Field, platform, useAction } from "./shared";
import { compareText } from "~/lib/text-diff";
export function TextCompare() {
  const [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [ignore, setIgnore] = useState(false),
    [result, setResult] = useState<
      | ({ left: string; right: string; ignore: boolean } & ReturnType<
          typeof compareText
        >)
      | null
    >(null),
    [changesOnly, setChangesOnly] = useState(false);
  const action = useAction();
  return (
    <section aria-label="Text comparison" className="space-y-4">
      <p className="text-sm text-zinc-500">
        Compare two UTF-8 files up to 256 KiB each. Limit: 1,500 lines per file
        and one million line pairs. Files remain unchanged.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            setResult(null);
            const [a, b] = await Promise.all([
              platform("/text?path=" + encodeURIComponent(left)),
              platform("/text?path=" + encodeURIComponent(right)),
            ]);
            setResult({
              left: a.path,
              right: b.path,
              ignore,
              ...compareText(a.text, b.text, ignore),
            });
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Original file path"
            required
            value={left}
            disabled={action.busy}
            onChange={(e) => setLeft(e.target.value)}
          />
          <Field
            label="Updated file path"
            required
            value={right}
            disabled={action.busy}
            onChange={(e) => setRight(e.target.value)}
          />
        </div>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={ignore}
            disabled={action.busy}
            onChange={(e) => setIgnore(e.target.checked)}
          />
          Ignore leading, trailing and repeated whitespace
        </label>
        <Button disabled={action.busy}>Compare text files</Button>
      </form>
      {action.error ? <p role="alert">{action.error}</p> : null}
      {result ? (
        <>
          <p className="break-all text-sm">
            {result.left} → {result.right}
          </p>
          <p role="status">
            {result.added} lines added · {result.removed} lines removed
            {result.ignore ? " · Whitespace ignored" : ""}
          </p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={changesOnly}
              onChange={(e) => setChangesOnly(e.target.checked)}
            />
            Show changed lines only
          </label>
          <div
            className="max-h-96 overflow-auto rounded-lg border p-3 font-mono text-xs"
            aria-label="Compared lines"
          >
            {result.lines
              .filter((l) => !changesOnly || l.kind !== "same")
              .map((l, i) => (
                <div
                  key={i}
                  className={
                    "flex gap-3 whitespace-pre " +
                    (l.kind === "added"
                      ? "bg-green-100 text-green-950 dark:bg-green-950 dark:text-green-100"
                      : l.kind === "removed"
                        ? "bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100"
                        : "")
                  }
                >
                  <span className="w-20 shrink-0 opacity-70">
                    {l.before ?? "—"}:{l.after ?? "—"}{" "}
                    {l.kind === "added"
                      ? "+"
                      : l.kind === "removed"
                        ? "−"
                        : " "}
                  </span>
                  <span>{l.text || " "}</span>
                </div>
              ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
