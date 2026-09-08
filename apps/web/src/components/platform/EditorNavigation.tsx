import { useEffect, useState, type RefObject } from "react";
import { Button } from "~/components/ui/button";
import { Field } from "./shared";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { lineRange, editorPosition } from "~/lib/editor-position";
export function EditorNavigation({
  editor,
  value,
  wrap,
  onWrap,
}: {
  editor: RefObject<HTMLTextAreaElement | null>;
  value: string;
  wrap: boolean;
  onWrap: (wrap: boolean) => void;
}) {
  const [line, setLine] = useState("1"),
    [error, setError] = useState(""),
    [position, setPosition] = useState({ line: 1, column: 1, selected: 0 });
  useEffect(() => {
    const field = editor.current;
    if (!field) return;
    const update = () =>
      setPosition(
        editorPosition(field.value, field.selectionStart, field.selectionEnd),
      );
    update();
    for (const event of ["select", "keyup", "click", "input"])
      field.addEventListener(event, update);
    return () => {
      for (const event of ["select", "keyup", "click", "input"])
        field.removeEventListener(event, update);
    };
  }, [editor, value]);
  const lines = value.split("\n").length;
  return (
    <Disclosure>
      <DisclosureSummary>
        Editor navigation · Ln {position.line}, Col {position.column}
        {position.selected ? ` · ${position.selected} selected` : ""}
      </DisclosureSummary>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const field = editor.current;
            if (!field) return;
            const range = lineRange(field.value, Number(line));
            field.focus();
            field.setSelectionRange(range.start, range.end);
            setPosition(editorPosition(field.value, range.start, range.end));
            setError("");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Cannot locate line");
          }
        }}
      >
        <Field
          label="Go to line"
          type="number"
          min={1}
          max={lines}
          step={1}
          required
          value={line}
          onChange={(e) => setLine(e.target.value)}
        />
        <Button variant="outline">Select line</Button>
      </form>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={wrap}
          onChange={(e) => onWrap(e.target.checked)}
        />
        Wrap long lines
      </label>
      <p className="text-xs text-muted-foreground">
        {lines} logical lines. Wrapped display lines do not change line numbers
        or file contents.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Disclosure>
  );
}
