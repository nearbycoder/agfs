import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Field } from "./shared";
import { textReplacement } from "~/lib/text-replace";
export function TextReplace({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [find, setFind] = useState(""),
    [replacement, setReplacement] = useState(""),
    [matchCase, setMatchCase] = useState(true),
    [wholeWord, setWholeWord] = useState(false),
    [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const result = useMemo(() => {
    try {
      return {
        ...textReplacement(value, find, replacement, matchCase, wholeWord),
        error: "",
      };
    } catch (e) {
      return {
        output: value,
        count: 0,
        samples: [],
        error: e instanceof Error ? e.message : "Cannot replace",
      };
    }
  }, [value, find, replacement, matchCase, wholeWord]);
  return (
    <Disclosure>
      <DisclosureSummary>Find & replace in this draft</DisclosureSummary>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Find literal text"
          maxLength={256}
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        <label className="grid gap-2 text-sm">
          Replace with
          <textarea
            className="rounded-lg border bg-transparent p-3"
            rows={2}
            maxLength={4096}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => setMatchCase(e.target.checked)}
          />
          Match case
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => setWholeWord(e.target.checked)}
          />
          Whole words
        </label>
      </div>
      <p role="status" className="text-sm">
        {result.count} matches · Previewing up to 5 contexts
      </p>
      {result.samples.length ? (
        <div className="grid gap-3">
          {result.samples.map((sample, i) => (
            <div
              key={i}
              className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2"
            >
              <div>
                <h4 className="mb-1 text-xs text-muted-foreground">Before</h4>
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {sample.before}
                </pre>
              </div>
              <div>
                <h4 className="mb-1 text-xs text-muted-foreground">After</h4>
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {sample.after}
                </pre>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            disabled ||
            !!result.error ||
            !result.count ||
            result.output === value
          }
          onClick={() => {
            setUndo({ before: value, after: result.output });
            onChange(result.output);
          }}
        >
          Replace all in draft
        </Button>
        <Button
          variant="outline"
          disabled={disabled || !undo || value !== undo.after}
          onClick={() => {
            if (undo) {
              onChange(undo.before);
              setUndo(null);
            }
          }}
        >
          Undo replacement
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Changes stay in the editor until you save. Undo is available until
        another edit or save changes this draft.
      </p>
      {result.error ? (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      ) : null}
    </Disclosure>
  );
}
