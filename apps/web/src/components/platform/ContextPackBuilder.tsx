import { useState } from "react";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Button } from "~/components/ui/button";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { contextPack, type ContextFile } from "~/lib/agent-context";
import type { AgentOutput as Output } from "~/lib/agent-tool-runner";
import { AgentOutput } from "./AgentOutput";
import { platform, useAction } from "./shared";
export function ContextPackBuilder() {
  const [paths, setPaths] = useState(""),
    [instructions, setInstructions] = useState(""),
    [budget, setBudget] = useState("8000"),
    [result, setResult] = useState<Output | null>(null);
  const action = useAction();
  return (
    <section className="agent-tool-form" aria-label="Context pack builder">
      <p className="section-copy">
        Bundle up to 20 UTF-8 workspace files, in the order you choose, with
        paths and version ETags. The budget uses a UTF-8 bytes ÷ 3 estimate, not
        a model tokenizer. An oversized pack is refused without truncating
        content. Review files for sensitive data before passing them to an
        agent.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            setResult(null);
            const selected = paths
              .split(/\r\n|\n|\r/)
              .map((p) => p.trim())
              .filter(Boolean);
            if (
              !selected.length ||
              selected.length > 20 ||
              new Set(selected).size !== selected.length ||
              selected.some((p) => !p.startsWith("/"))
            )
              throw new Error("Provide 1–20 distinct absolute file paths.");
            const files: ContextFile[] = [];
            // Small batches avoid flooding the Worker while preserving user order.
            let bytes = 0;
            for (let i = 0; i < selected.length; i += 3) {
              const batch = await Promise.all(
                selected.slice(i, i + 3).map(async (path) => {
                  const file = await platform(
                    "/text?path=" + encodeURIComponent(path),
                  );
                  return { path: file.path, text: file.text, etag: file.etag };
                }),
              );
              for (const file of batch) {
                bytes += new TextEncoder().encode(file.text).length;
                if (bytes > 262144)
                  throw new Error(
                    "Combined source files exceed 256 KiB. Narrow the selection.",
                  );
                files.push(file);
              }
            }
            const pack = contextPack(files, Number(budget), instructions);
            setResult({
              output: pack.output,
              filename: "agent-context.json",
              summary: `${files.length} files · approximately ${pack.estimatedTokens.toLocaleString()} tokens · No truncation`,
            });
          });
        }}
      >
        <label className="grid gap-2 text-sm font-medium">
          Workspace paths, one per line
          <Textarea
            rows={5}
            required
            disabled={action.busy}
            maxLength={82000}
            value={paths}
            placeholder={"/brief.md\n/inputs/data.json"}
            onChange={(e) => {
              setPaths(e.target.value);
              setResult(null);
            }}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Agent instructions
          <Textarea
            rows={4}
            disabled={action.busy}
            maxLength={16000}
            value={instructions}
            placeholder="Review these inputs and write your findings into /outputs…"
            onChange={(e) => {
              setInstructions(e.target.value);
              setResult(null);
            }}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Estimated token budget
          <Input
            type="number"
            min={100}
            max={100000}
            required
            disabled={action.busy}
            value={budget}
            onChange={(e) => {
              setBudget(e.target.value);
              setResult(null);
            }}
          />
        </label>
        <Button className="self-start" disabled={action.busy}>
          {action.busy ? "Building context…" : "Build context pack"}
        </Button>
      </form>
      {action.error ? (
        <Alert variant="destructive">
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
      {result ? <AgentOutput result={result} /> : null}
    </section>
  );
}
