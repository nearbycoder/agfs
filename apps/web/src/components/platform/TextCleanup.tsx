import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Select, SelectItem } from "~/components/ui/select";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { cleanText, type CleanupOptions } from "~/lib/text-cleanup";
const initial: CleanupOptions = {
  trimTrailing: true,
  tabs: "keep",
  blankLines: "keep",
  lineEndings: "preserve",
  finalNewline: "preserve",
};
export function TextCleanup({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [options, setOptions] = useState(initial),
    [showWhitespace, setShowWhitespace] = useState(true),
    [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const result = useMemo(() => {
    if (!open) return null;
    let output = value;
    let error = "";
    try {
      output = cleanText(value, options);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not clean text";
    }
    const encoder = new TextEncoder();
    const beforeBytes = encoder.encode(value).length;
    return {
      value: output,
      error,
      beforeBytes,
      afterBytes:
        output === value ? beforeBytes : encoder.encode(output).length,
    };
  }, [open, value, options]);
  const controls = [
    {
      key: "tabs",
      label: "Tabs",
      choices: [
        ["keep", "Keep tabs"],
        ["2", "Replace with 2 spaces"],
        ["4", "Replace with 4 spaces"],
      ],
    },
    {
      key: "blankLines",
      label: "Blank lines",
      choices: [
        ["keep", "Keep all"],
        ["collapse", "Collapse consecutive blanks"],
        ["remove", "Remove blank lines"],
      ],
    },
    {
      key: "lineEndings",
      label: "Line endings",
      choices: [
        ["preserve", "Preserve existing"],
        ["lf", "LF (Unix)"],
        ["crlf", "CRLF (Windows)"],
      ],
    },
    {
      key: "finalNewline",
      label: "Final newline",
      choices: [
        ["preserve", "Preserve existing"],
        ["ensure", "Ensure one newline"],
        ["remove", "Remove final newlines"],
      ],
    },
  ] as const;
  function preview(text: string) {
    const cut = text.slice(0, 4000);
    return showWhitespace
      ? cut
          .replace(/ /g, "·")
          .replace(/\t/g, "→")
          .replace(/\r/g, "␍")
          .replace(/\n/g, "↵\n")
      : cut;
  }
  return (
    <Disclosure
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <DisclosureSummary>Cleanup recipes</DisclosureSummary>
      {result ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {controls.map((control) => (
              <label key={control.key} className="grid gap-2 text-sm">
                {control.label}
                <Select
                  aria-label={"Cleanup " + control.label.toLowerCase()}
                  value={options[control.key]}
                  onValueChange={(selected) =>
                    setOptions({ ...options, [control.key]: selected })
                  }
                >
                  {control.choices.map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.trimTrailing}
              onChange={(e) =>
                setOptions({ ...options, trimTrailing: e.target.checked })
              }
            />
            Trim trailing spaces and tabs
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showWhitespace}
              onChange={(e) => setShowWhitespace(e.target.checked)}
            />
            Show whitespace in preview
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: "Before", text: value, bytes: result.beforeBytes },
              { label: "After", text: result.value, bytes: result.afterBytes },
            ].map(({ label, text, bytes }) => (
              <section key={label} className="min-w-0 space-y-2">
                <h4 className="text-sm font-medium">
                  {label} · {bytes.toLocaleString()} bytes
                </h4>
                <pre className="max-h-52 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-all">
                  {preview(text) || "(empty)"}
                </pre>
              </section>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Preview shows the first 4,000 characters. Recipes apply to the whole
            draft and can change whitespace inside string literals. Review
            before applying; the file is unchanged until Save.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={disabled || !!result.error || result.value === value}
              onClick={() => {
                if (disabled || result.error || result.value === value) return;
                setUndo({ before: value, after: result.value });
                onChange(result.value);
              }}
            >
              Apply cleanup to draft
            </Button>
            <Button
              variant="outline"
              disabled={disabled || !undo || value !== undo.after}
              onClick={() => {
                if (!disabled && undo && value === undo.after) {
                  onChange(undo.before);
                  setUndo(null);
                }
              }}
            >
              Undo cleanup
            </Button>
          </div>
          {result.error ? (
            <p role="alert" className="text-sm text-destructive">
              {result.error}
            </p>
          ) : null}
        </>
      ) : null}
    </Disclosure>
  );
}
