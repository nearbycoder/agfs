import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Button } from "~/components/ui/button";
import { Field } from "./shared";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import {
  createEditorIndex,
  lineRange,
  editorPosition,
  type EditorIndex,
} from "~/lib/editor-position";
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
  const index = useRef<EditorIndex | null>(null);
  if (index.current === null) index.current = createEditorIndex(value);
  const [line, setLine] = useState("1"),
    [error, setError] = useState(""),
    [position, setPosition] = useState({
      line: 1,
      column: 1,
      selected: 0,
      lines: index.current.lineStarts.length,
    });
  const readIndex = useCallback(
    (field: HTMLTextAreaElement, refresh = false) => {
      // Only input and prop changes need to read the draft. Other caret events
      // reuse the index, including Unicode metadata, without touching its text.
      if (!index.current || (refresh && index.current.text !== field.value))
        index.current = createEditorIndex(field.value);
      return index.current;
    },
    [],
  );
  const updatePosition = useCallback(
    (refresh = false) => {
      const field = editor.current;
      if (!field) return;
      const current = readIndex(field, refresh);
      const next = {
        ...editorPosition(current, field.selectionStart, field.selectionEnd),
        lines: current.lineStarts.length,
      };
      setPosition((previous) =>
        previous.line === next.line &&
        previous.column === next.column &&
        previous.selected === next.selected &&
        previous.lines === next.lines
          ? previous
          : next,
      );
    },
    [editor, readIndex],
  );
  useEffect(() => {
    // Covers replacements, undo, and opening a document without an input event.
    // Read textarea.value because browsers normalize CRLF in textarea offsets.
    updatePosition(true);
  }, [value, updatePosition]);
  useEffect(() => {
    const field = editor.current;
    if (!field) return;
    const update = () => updatePosition();
    const input = () => updatePosition(true);
    for (const event of ["select", "keyup", "click"])
      field.addEventListener(event, update);
    field.addEventListener("input", input);
    return () => {
      for (const event of ["select", "keyup", "click"])
        field.removeEventListener(event, update);
      field.removeEventListener("input", input);
    };
  }, [editor, updatePosition]);
  const lines = position.lines;
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
            const range = lineRange(readIndex(field, true), Number(line));
            field.focus();
            field.setSelectionRange(range.start, range.end);
            updatePosition();
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
