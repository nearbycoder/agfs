import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Select, SelectItem } from "~/components/ui/select";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { useAction } from "./shared";
import { selectionCopy, type PathCopyFormat } from "~/lib/selection-copy";
import { downloadText } from "~/lib/download-text";
export function SelectionClipboard({ paths }: { paths: string[] }) {
  const [format, setFormat] = useState<PathCopyFormat>("lines");
  const action = useAction();
  const result = useMemo(() => {
    try {
      return { value: selectionCopy(paths, format), error: "" };
    } catch (error) {
      return {
        value: "",
        error: error instanceof Error ? error.message : "Cannot format paths",
      };
    }
  }, [paths, format]);
  return (
    <Disclosure>
      <DisclosureSummary>
        <Copy className="size-4" />
        Selection clipboard · {paths.length} files
      </DisclosureSummary>
      <label className="grid gap-2 text-sm">
        Path format
        <Select
          aria-label="Path copy format"
          value={format}
          onValueChange={(value) => setFormat(value as PathCopyFormat)}
        >
          <SelectItem value="lines">One path per line</SelectItem>
          <SelectItem value="json">JSON array</SelectItem>
          <SelectItem value="shell">POSIX shell arguments</SelectItem>
        </Select>
      </label>
      <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap break-all">
        {result.value}
      </pre>
      <p className="text-xs text-muted-foreground">
        Copies paths only, including selections on other pages. Shell format
        quotes each argument for a POSIX shell; use JSON for other shells.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!!result.error || action.busy || !paths.length}
          onClick={() =>
            void action.run(async () => {
              await navigator.clipboard.writeText(result.value);
              action.setNotice(`${paths.length} paths copied.`);
            })
          }
        >
          Copy selected paths
        </Button>
        <Button
          variant="outline"
          disabled={!!result.error || !paths.length}
          onClick={() =>
            downloadText(
              "agfs-selected-paths." + (format === "json" ? "json" : "txt"),
              result.value,
              format === "json"
                ? "application/json"
                : "text/plain;charset=utf-8",
            )
          }
        >
          Download path list
        </Button>
      </div>
      {result.error || action.error ? (
        <p role="alert" className="text-sm text-destructive">
          {result.error ||
            "Clipboard unavailable. Download the list or copy from the preview."}
        </p>
      ) : null}
      {action.notice ? (
        <p role="status" className="text-sm">
          {action.notice}
        </p>
      ) : null}
    </Disclosure>
  );
}
