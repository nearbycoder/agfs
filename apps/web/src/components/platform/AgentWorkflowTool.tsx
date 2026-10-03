import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Select, SelectItem } from "~/components/ui/select";
import { Alert, AlertDescription } from "~/components/ui/alert";
import type { AgentToolId } from "~/lib/agent-tool-catalog";
import {
  runAgentTool,
  type AgentOutput as Output,
} from "~/lib/agent-tool-runner";
import { decodeEditableText } from "~/lib/text-format";
import { TextToolSource } from "./TextToolSource";
import { AgentOutput } from "./AgentOutput";
import { useAction } from "./shared";

type Option = {
  key: string;
  label: string;
  value: string;
  choices?: [string, string][];
  type?: string;
  hint?: string;
};
const delimiter: Option = {
  key: "delimiter",
  label: "Input delimiter",
  value: ",",
  choices: [
    [",", "Comma"],
    [";", "Semicolon"],
    ["\t", "Tab"],
  ],
};
const config: Partial<
  Record<
    AgentToolId,
    { input: string; secondary?: string; hint: string; options?: Option[] }
  >
> = {
  "context-chunker": {
    input: "Context text",
    hint: "Whole lines are preserved. Output includes exact line ranges; overlap repeats only whole lines. Chunk sizes count characters, not model tokens.",
    options: [
      {
        key: "size",
        label: "Maximum characters per chunk",
        value: "4000",
        type: "number",
      },
      { key: "overlap", label: "Overlap lines", value: "2", type: "number" },
    ],
  },
  "prompt-variables": {
    input: "Prompt template",
    secondary: "Variables as a JSON object of strings",
    hint: "Use {{name}} placeholders. Values are inserted once as literal text. Missing or non-string values stop rendering.",
  },
  "json-merge-patch": {
    input: "Target JSON",
    secondary: "Merge patch JSON",
    hint: "Objects merge recursively, null removes object keys, and arrays or scalars replace their target. Exact numeric values are preserved.",
  },
  "json-redactor": {
    input: "Source JSON",
    secondary: "JSON Pointers to redact, one per line",
    hint: "Use /credentials/token or /users/0/email. Escape / as ~1 and ~ as ~0. Missing paths stop redaction. Review the entire output before sharing; only your selected paths are redacted.",
  },
  "json-shape": {
    input: "JSON sample",
    hint: "Shows observed field types and occurrences. Array items share a /* path. This profile describes this sample; it is not a validation schema.",
  },
  "json-records": {
    input: "JSON array",
    hint: "Use a JSON Pointer relative to each record. Equals compares exact JSON representation, including object key order; contains compares text. An empty pointer selects the entire record.",
    options: [
      { key: "pointer", label: "Field pointer", value: "/status" },
      {
        key: "mode",
        label: "Condition",
        value: "equals",
        choices: [
          ["equals", "Equals JSON value"],
          ["contains", "Contains text"],
          ["exists", "Field exists"],
          ["missing", "Field missing"],
        ],
      },
      {
        key: "expected",
        label: "Expected JSON value or text",
        value: '"completed"',
      },
    ],
  },
  "array-jsonl": {
    input: "JSON array",
    hint: "Every array item becomes one line. Exact number literals are retained. Empty arrays produce empty output.",
  },
  "jsonl-array": {
    input: "JSONL records",
    hint: "Blank lines are skipped; invalid JSON reports its source line. Output is also checked against aggregate nesting and value limits.",
  },
  "csv-project": {
    input: "Source CSV",
    secondary: "Column names, one per line in desired order",
    hint: "Headers must be unique; all rows must have the same width. CSV output protects spreadsheet formula cells with a leading apostrophe.",
    options: [delimiter],
  },
  "csv-join": {
    input: "Left CSV",
    secondary: "Right lookup CSV",
    hint: "Right-side keys must be unique and nonempty. Left joins retain unmatched rows; inner joins omit them. Duplicate column names get a right. prefix. Output protects spreadsheet formulas.",
    options: [
      delimiter,
      { key: "key", label: "Shared key column", value: "id" },
      {
        key: "mode",
        label: "Join type",
        value: "left",
        choices: [
          ["left", "Left join"],
          ["inner", "Inner join"],
        ],
      },
    ],
  },
  "csv-markdown": {
    input: "Source CSV",
    hint: "The first row supplies the headers. Pipes, backslashes, and HTML angle brackets are escaped; multiline cells become one line.",
    options: [delimiter],
  },
  "line-sets": {
    input: "Left list, one item per line",
    secondary: "Right list, one item per line",
    hint: "Duplicate items collapse. Comparison is case-sensitive and preserves first-seen order. Empty interior lines count as items.",
    options: [
      {
        key: "mode",
        label: "Set operation",
        value: "left-only",
        choices: [
          ["left-only", "Only in left"],
          ["right-only", "Only in right"],
          ["intersection", "Shared items"],
          ["union", "All unique items"],
        ],
      },
      {
        key: "normalize",
        label: "Whitespace",
        value: "exact",
        choices: [
          ["exact", "Preserve whitespace"],
          ["trim", "Trim each item"],
        ],
      },
    ],
  },
  "path-scope": {
    input: "Absolute file paths, one per line",
    hint: "Supports * within one segment, ** across segments, and ? for one character. **/ also matches zero folders. This is a planning aid; AGFS token authorization uses literal folder boundaries, not globs.",
    options: [
      { key: "pattern", label: "Glob pattern", value: "/outputs/**/*.json" },
    ],
  },
  "webhook-verifier": {
    input: "Exact raw request body",
    hint: "Paste the original body without reformatting. Secret and body stay in this tab. No network request is made. A valid signature also needs a timestamp within the past five minutes.",
    options: [
      { key: "secret", label: "Signing secret", value: "", type: "password" },
      { key: "timestamp", label: "X-AGFS-Timestamp (Unix seconds)", value: "" },
      {
        key: "signature",
        label: "X-AGFS-Signature",
        value: "",
        hint: "v1=… (comma-separated signatures accepted)",
      },
    ],
  },
};
export function AgentWorkflowTool({ id }: { id: AgentToolId }) {
  const spec = config[id]!;
  const [input, setInput] = useState(""),
    [secondary, setSecondary] = useState("");
  const [options, setOptions] = useState<Record<string, string>>(() =>
    Object.fromEntries((spec.options ?? []).map((v) => [v.key, v.value])),
  );
  const [result, setResult] = useState<Output | null>(null);
  const action = useAction();
  function change(set: () => void) {
    set();
    setResult(null);
  }
  return (
    <section className="agent-tool-form" aria-label={id + " workbench"}>
      <p className="section-copy">{spec.hint}</p>
      {id !== "webhook-verifier" ? (
        <TextToolSource
          label="Source"
          disabled={action.busy}
          onLoad={(file) => change(() => setInput(file.text))}
        />
      ) : null}
      <label className="grid gap-2 text-sm font-medium">
        {spec.input}
        <Textarea
          rows={7}
          maxLength={262144}
          value={input}
          disabled={action.busy}
          onChange={(e) => change(() => setInput(e.target.value))}
        />
      </label>
      {id !== "webhook-verifier" ? (
        <label className="grid gap-2 text-xs text-muted-foreground">
          Or load a local text file (up to 256 KiB)
          <Input
            type="file"
            disabled={action.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                void action.run(async () => {
                  if (file.size > 262144)
                    throw new Error("File exceeds 256 KiB.");
                  const text = decodeEditableText(await file.arrayBuffer());
                  change(() => setInput(text));
                });
            }}
          />
        </label>
      ) : null}
      {spec.secondary ? (
        <>
          <TextToolSource
            label="Additional source"
            disabled={action.busy}
            onLoad={(file) => change(() => setSecondary(file.text))}
          />
          <label className="grid gap-2 text-sm font-medium">
            {spec.secondary}
            <Textarea
              rows={5}
              maxLength={262144}
              value={secondary}
              disabled={action.busy}
              onChange={(e) => change(() => setSecondary(e.target.value))}
            />
          </label>
        </>
      ) : null}
      <fieldset
        className="grid min-w-0 gap-4 sm:grid-cols-2"
        disabled={action.busy}
      >
        <legend className="sr-only">Processing options</legend>
        {spec.options?.map((option) => (
          <label
            key={option.key}
            className="grid content-start gap-2 text-sm font-medium"
          >
            {option.label}
            {option.choices ? (
              <Select
                aria-label={option.label}
                value={options[option.key]}
                disabled={action.busy}
                onValueChange={(v) =>
                  change(() => setOptions({ ...options, [option.key]: v }))
                }
              >
                {option.choices.map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
            ) : (
              <Input
                type={option.type ?? "text"}
                value={options[option.key]}
                maxLength={4096}
                autoComplete="off"
                onChange={(e) =>
                  change(() =>
                    setOptions({ ...options, [option.key]: e.target.value }),
                  )
                }
              />
            )}
            {option.hint ? (
              <span className="text-xs font-normal text-muted-foreground">
                {option.hint}
              </span>
            ) : null}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              setResult(null);
              const output = await runAgentTool(id, input, secondary, options);
              setResult(output);
            })
          }
        >
          {action.busy ? "Processing…" : "Generate preview"}
        </Button>
        <p className="text-xs text-muted-foreground">
          256 KiB per input and output · Processes in your browser
        </p>
      </div>
      {action.error ? (
        <Alert variant="destructive">
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
      {result ? (
        <AgentOutput result={result} allowSave={id !== "webhook-verifier"} />
      ) : null}
    </section>
  );
}
