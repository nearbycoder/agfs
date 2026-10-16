import { useState } from "react";
import { Copy, Download, Save } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { saveBrowserText } from "~/lib/browser-text";
import { downloadText } from "~/lib/download-text";
import { useAction } from "./shared";
import type { AgentOutput as Output } from "~/lib/agent-tool-runner";
export function AgentOutput({
  result,
  allowSave = true,
}: {
  result: Output;
  allowSave?: boolean;
}) {
  const action = useAction(),
    [destination, setDestination] = useState("");
  return (
    <section className="agent-output" aria-label="Generated output">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Review output</h3>
          <p role="status" className="section-copy">
            {result.summary}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await navigator.clipboard.writeText(result.output);
                action.setNotice("Output copied.");
              })
            }
          >
            <Copy data-icon="inline-start" />
            Copy
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadText(result.filename, result.output)}
          >
            <Download data-icon="inline-start" />
            Download
          </Button>
        </div>
      </div>
      <pre className="agent-code-preview">
        {result.output.slice(0, 16000) || "(empty output)"}
      </pre>
      {result.output.length > 16000 ? (
        <p className="text-xs text-muted-foreground">
          Preview shows 16,000 characters. Copy and download include the full
          output.
        </p>
      ) : null}
      {allowSave ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              if (!destination.startsWith("/"))
                throw new Error("Use an absolute destination path.");
              await saveBrowserText(
                destination,
                result.output,
                null,
                result.filename.endsWith(".json")
                  ? "application/json"
                  : "text/plain",
              );
              action.setNotice("Created " + destination);
            });
          }}
        >
          <label className="grid flex-1 gap-2 text-sm font-medium">
            Save as a new workspace file
            <Input
              required
              maxLength={4096}
              value={destination}
              disabled={action.busy}
              placeholder={"/agent-inputs/" + result.filename}
              onChange={(e) => setDestination(e.target.value)}
            />
          </label>
          <Button disabled={action.busy} variant="outline">
            <Save data-icon="inline-start" />
            Create file
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            Existing destinations are refused. Source files are unchanged.
          </p>
        </form>
      ) : null}
      {action.error ? (
        <Alert variant="destructive">
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
      {action.notice ? (
        <p role="status" className="text-sm">
          {action.notice}
        </p>
      ) : null}
    </section>
  );
}
