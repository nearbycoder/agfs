import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Select, SelectItem } from "~/components/ui/select";
import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "~/components/ui/table";
import {
  browserFeatures,
  type BrowserFeatureGroup,
  type BrowserFeatureId,
} from "~/lib/browser-feature-catalog";
import type { FeatureResult } from "~/lib/browser-feature-core";
import { decodeEditableText } from "~/lib/text-format";
import { useBrowserRead } from "~/lib/use-browser-read";
import { AgentOutput, type OutputSaveState } from "./AgentOutput";
import { ResultPageControls, useResultPage } from "./ResultPage";
import { platform } from "./shared";

type Option = {
  key: string;
  label: string;
  value: string;
  choices?: [string, string][];
  multiline?: boolean;
};
type Configuration = {
  hint: string;
  input?: string;
  secondary?: string;
  example: string;
  extra?: string;
  options: Option[];
};
const pointer: Option = {
  key: "pointer",
  label: "Field pointer (empty selects the whole record)",
  value: "/id",
};
const keep: Option = {
  key: "keep",
  label: "Keep occurrence",
  value: "first",
  choices: [
    ["first", "First"],
    ["last", "Last"],
  ],
};
const direction: Option = {
  key: "direction",
  label: "Sort direction",
  value: "asc",
  choices: [
    ["asc", "Ascending"],
    ["desc", "Descending"],
  ],
};
const delimiter: Option = {
  key: "delimiter",
  label: "CSV delimiter",
  value: ",",
  choices: [
    [",", "Comma"],
    [";", "Semicolon"],
    ["\t", "Tab"],
  ],
};
const column: Option = { key: "column", label: "Key column", value: "id" };
const columns: Option = {
  key: "columns",
  label: "Key columns, one per line",
  value: "team",
  multiline: true,
};
const jsonExample =
  '[{"id":"a","team":"north","amount":9007199254740993},{"id":"b","team":"south","amount":2},{"id":"a","team":"north","amount":3}]';
const csvExample = "id,team,amount\na,north,0.1\nb,south,0.2\nc,north,0.2\n";
export const preparationConfig: Record<BrowserFeatureId, Configuration> = {
  "record-project": {
    hint: 'Map output names to nested JSON Pointers, for example {"owner":"/user/name"}. Escape / as ~1 and ~ as ~0. Only mapped fields are exported.',
    example: jsonExample,
    secondary: "Output name → pointer mapping (JSON object)",
    extra: '{"identifier":"/id","total":"/amount"}',
    options: [
      {
        key: "missing",
        label: "Missing source fields",
        value: "error",
        choices: [
          ["error", "Stop with an error"],
          ["null", "Write null"],
          ["omit", "Omit the field"],
        ],
      },
    ],
  },
  "record-dedupe": {
    hint: "Choose a key pointer, or leave it empty to compare whole records. Object key order is ignored; equivalent numeric values match exactly. Missing keys form their own group, distinct from null. Surviving numeric literals are preserved.",
    example: jsonExample,
    options: [pointer, keep],
  },
  "record-group": {
    hint: "Group on a string, number, boolean, or null. Missing keys stop the preview. Equivalent numeric values share a group; each group retains its first key literal and source order.",
    example: jsonExample,
    options: [{ ...pointer, value: "/team" }],
  },
  "record-sort": {
    hint: "Stable scalar sorting: null, boolean, number, then string in ascending order; descending reverses that order. Text uses case-sensitive code-unit order. Missing fields stop the preview; equal keys retain source order.",
    example: jsonExample,
    options: [{ ...pointer, value: "/amount" }, direction],
  },
  "record-index": {
    hint: "Build an object whose keys come from a unique string field. Duplicate, missing, or non-string keys stop the preview. Choose a genuinely unique field before indexing.",
    example: '[{"id":"a","amount":9007199254740993},{"id":"b","amount":2}]',
    options: [pointer],
  },
  "record-patch": {
    input: "Source JSON document",
    hint: "Preview up to 100 JSON Patch operations in order. Arrays use zero-based indices; add also accepts -. Test compares JSON values without numeric rounding. Removing the root is refused because no JSON output would remain; replace the root instead. Any failed operation refuses the whole preview.",
    example: '{"items":["draft","ready"],"version":1}',
    secondary: "JSON Patch operations",
    extra:
      '[{"op":"test","path":"/version","value":1.0},{"op":"move","from":"/items/0","path":"/items/1"},{"op":"replace","path":"/version","value":2}]',
    options: [],
  },
  "record-audit": {
    hint: "Rules require pointer and type; required defaults to true. Types: string, number, boolean, null, array, object. This is a small record contract, not JSON Schema. Counts cover all records; at most 1,000 findings are reported.",
    example: '[{"id":"a","amount":1},{"id":2},{"id":"c","amount":null}]',
    secondary: "Contract rules (JSON array)",
    extra:
      '[{"pointer":"/id","type":"string"},{"pointer":"/amount","type":"number","required":true}]',
    options: [],
  },
  "table-sort": {
    hint: "Select one column. Text order is case-sensitive; decimal order is exact, including large integers and exponents. Numeric sorting refuses blanks and invalid numbers. Equal keys keep their original order.",
    example: csvExample,
    options: [
      delimiter,
      { ...column, value: "amount" },
      {
        key: "type",
        label: "Sort values as",
        value: "number",
        choices: [
          ["number", "Exact decimal numbers"],
          ["text", "Text"],
        ],
      },
      direction,
    ],
  },
  "table-dedupe": {
    hint: "Select one or more exact header names. Key cells are compared as text, so empty strings and distinct decimal spellings remain distinct. Retained rows stay in source order.",
    example: csvExample,
    options: [delimiter, columns, keep],
  },
  "table-group": {
    hint: "Group by exact header names; leave the group list empty for one summary. Counts are always included. An optional numeric column adds an exact decimal sum. Normalized exponents must be within ±1,000 and working sums within 2,048 digits.",
    example: csvExample,
    options: [
      delimiter,
      { ...columns, label: "Group columns, one per line (empty = all rows)" },
      { key: "sum", label: "Column to sum (optional)", value: "amount" },
    ],
  },
  "table-unpivot": {
    hint: "Retain identity columns and convert selected measures into field/value rows. Unselected columns are omitted. Identity and measure lists must be disjoint. The resulting table is checked before expansion.",
    example: "id,jan,feb\na,10,20\nb,30,40\n",
    options: [
      delimiter,
      { ...columns, label: "Identity columns, one per line", value: "id" },
      {
        key: "measures",
        label: "Measure columns, one per line",
        value: "jan\nfeb",
        multiline: true,
      },
    ],
  },
  "table-append": {
    hint: "Append the second table after the first, matching exact header names. Strict mode requires matching names in any order. Union mode includes all columns and fills absent cells with empty strings.",
    example: csvExample,
    secondary: "CSV to append",
    extra: "amount,id,team\n0.3,d,south\n",
    options: [
      delimiter,
      {
        key: "mode",
        label: "Schema policy",
        value: "strict",
        choices: [
          ["strict", "Require the same columns"],
          ["union", "Union of all columns"],
        ],
      },
    ],
  },
  "table-rename": {
    hint: "Map existing names to their replacements. All renames are evaluated together, so swapping two headers works. Blank names, unknown source names, and destination collisions stop the preview.",
    example: csvExample,
    secondary: "Header mapping (JSON object)",
    extra: '{"id":"record_id","amount":"total"}',
    options: [delimiter],
  },
  "table-reconcile": {
    hint: "Compare tables with matching header names and unique, nonempty key cells. The report includes changed columns, complete before/after row arrays, and parsed record numbers (header is row 1). Column order may differ.",
    example: csvExample,
    secondary: "After CSV",
    extra: "id,team,amount\na,north,0.1\nb,south,0.5\nd,west,0.2\n",
    options: [delimiter, column],
  },
  "document-links": {
    input: "Markdown document",
    hint: "Inventories simple inline [label](target) links and images. Fenced/indented code and matched inline backtick spans are skipped. Reference links, HTML, autolinks, titles, escaped labels, and nested parentheses are outside the supported subset. Targets remain inert; classifications do not prove safety or existence.",
    example:
      "# Handoff\n[Guide](./guide.md)\n[API](https://example.test/api)\n[Review](javascript:alert)\n![Diagram](./diagram.png)\n",
    options: [
      {
        key: "filter",
        label: "Link view",
        value: "all",
        choices: [
          ["all", "All supported links"],
          ["review", "Targets needing review"],
        ],
      },
    ],
  },
  "document-tasks": {
    input: "Markdown document",
    hint: "Extracts - [ ], * [x], + [X], and numbered task items indented up to three spaces. Uses the nearest preceding ATX heading (# … ######). Fenced and indented code, deeply nested tasks, and setext headings are outside this subset.",
    example:
      "# Release\n- [ ] Review the manifest\n- [x] Prepare inputs\n## Follow-up\n1. [ ] Share the report\n",
    options: [
      {
        key: "status",
        label: "Task status",
        value: "all",
        choices: [
          ["all", "All tasks"],
          ["open", "Open tasks"],
          ["complete", "Completed tasks"],
        ],
      },
    ],
  },
  "document-redact": {
    input: "Text to redact",
    hint: "Supply named literal strings, not patterns. At each position the longest matching literal wins; replacement text is never processed again. Matching is case-sensitive. This is not automatic secret detection. Rule names appear in output, so use nonsensitive labels.",
    example: "Contact person@example.test about reference ACCT-1042.\n",
    secondary: "Redaction rules (JSON array)",
    extra:
      '[{"name":"email","literal":"person@example.test"},{"name":"account","literal":"ACCT-1042"}]',
    options: [],
  },
};

export function PreparationReview({ result }: { result: FeatureResult }) {
  const page = useResultPage(result.rows ?? []);
  if (!result.columns) return null;
  return (
    <section className="space-y-3" aria-label="Preview findings">
      <h3 className="font-semibold">Review findings</h3>
      {!page.total ? (
        <p role="status" className="text-sm text-muted-foreground">
          No matching findings in this preview.
        </p>
      ) : (
        <>
          <Table aria-label="Preview findings" scrollClassName="max-h-96">
            <TableHeader>
              <TableRow>
                {result.columns.map((name) => (
                  <TableHead key={name}>{name}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((row, i) => (
                <TableRow key={page.page * 100 + i}>
                  {row.map((cell, column) => (
                    <TableCell
                      key={column}
                      className="max-w-80 break-words whitespace-pre-wrap"
                    >
                      {cell.length > 300
                        ? cell.slice(0, 300) + "…"
                        : cell || "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ResultPageControls {...page} label="findings" />
          <p className="text-xs text-muted-foreground">
            Cells show up to 300 characters. The downloaded report includes full
            values.
          </p>
        </>
      )}
    </section>
  );
}

export function preparationContentType(filename: string) {
  if (filename.endsWith(".csv")) return "text/csv";
  if (filename.endsWith(".json")) return "application/json";
  if (filename.endsWith(".md")) return "text/markdown";
  return "text/plain";
}
export function DataPreparationWorkbench({
  group,
}: {
  group: BrowserFeatureGroup;
}) {
  const location = useLocation(),
    navigate = useNavigate(),
    available = browserFeatures.filter((feature) => feature.group === group);
  const linked = available.find(
    (feature) => feature.id === location.hash.replace(/^#/, ""),
  );
  const [id, setId] = useState<BrowserFeatureId>(linked?.id ?? available[0].id);
  const spec = preparationConfig[id],
    feature = browserFeatures.find((item) => item.id === id)!;
  const [saveState, setSaveState] = useState<OutputSaveState>({ busy: false });
  const saveRef = useRef(saveState);
  function saveChanged(state: OutputSaveState) {
    saveRef.current = state;
    setSaveState(state);
  }
  const defaults = (next: BrowserFeatureId) =>
    Object.fromEntries(
      preparationConfig[next].options.map((option) => [
        option.key,
        option.value,
      ]),
    );
  const [input, setInput] = useState(""),
    [secondary, setSecondary] = useState(""),
    [options, setOptions] = useState<Record<string, string>>(() =>
      defaults(id),
    );
  const [result, setResult] = useState<FeatureResult | null>(null),
    [sourcePath, setSourcePath] = useState(""),
    [target, setTarget] = useState("input"),
    [errorLane, setErrorLane] = useState<"read" | "preview" | null>(null);
  const reader = useBrowserRead(),
    preview = useBrowserRead(),
    busy = reader.busy || preview.busy || saveState.busy;
  function change(action: () => void) {
    if (saveRef.current.busy) return;
    reader.cancel();
    preview.cancel();
    action();
    setResult(null);
    setErrorLane(null);
  }
  function select(next: BrowserFeatureId, updateHash = true) {
    if (saveRef.current.busy) return;
    change(() => {
      setId(next);
      setOptions(defaults(next));
      setSecondary("");
      setTarget("input");
    });
    if (updateHash) void navigate({ hash: next, resetScroll: false });
  }
  useEffect(() => {
    const next =
      linked?.id ??
      (available.some((item) => item.id === id) ? id : available[0].id);
    if (!saveState.busy && next !== id) select(next, false);
  }, [linked?.id, group, saveState.busy]);
  const load = (text: string) => {
    (target === "secondary" ? setSecondary : setInput)(text);
    setResult(null);
  };
  async function generate() {
    if (saveRef.current.busy) return;
    setResult(null);
    setErrorLane("preview");
    await preview.run(async (signal) => {
      const run =
        group === "record-preparation"
          ? (await import("~/lib/browser-record-tools")).runRecordTool
          : group === "table-preparation"
            ? (await import("~/lib/browser-table-tools")).runTableTool
            : (await import("~/lib/browser-document-tools")).runDocumentTool;
      if (signal.aborted) throw new Error("Preview cancelled.");
      return run(id, input, secondary, options);
    }, setResult);
  }
  return (
    <section
      className="agent-tool-form min-w-0"
      aria-label={group.replaceAll("-", " ")}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <label className="grid content-start gap-2 text-sm font-medium">
          Choose a task
          <Select
            aria-label={group.replaceAll("-", " ") + " task"}
            value={id}
            disabled={busy}
            onValueChange={(value) => select(value as BrowserFeatureId)}
          >
            {available.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </Select>
        </label>
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="section-label">Prepare → Preview → Export</p>
          <h3 className="mt-1 font-semibold">{feature.label}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {feature.description}
          </p>
        </div>
      </div>
      <p className="section-copy">{spec.hint}</p>
      {group === "table-preparation" ? (
        <p className="text-xs text-muted-foreground">
          CSV exports prefix formula-like cells, including negative numbers,
          with an apostrophe. Those protected cells remain text if reused as
          input; keep your original source for further numeric operations.
        </p>
      ) : null}
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Load a workspace or local file
        </summary>
        <div className="mt-4 space-y-3">
          {spec.secondary ? (
            <label className="grid gap-2 text-sm">
              Load into
              <Select
                aria-label="Load into"
                value={target}
                disabled={busy}
                onValueChange={setTarget}
              >
                <SelectItem value="input">Source input</SelectItem>
                <SelectItem value="secondary">{spec.secondary}</SelectItem>
              </Select>
            </label>
          ) : null}
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (saveRef.current.busy) return;
              setResult(null);
              setErrorLane("read");
              void reader.run(
                (signal) =>
                  platform(
                    "/text?path=" + encodeURIComponent(sourcePath),
                    "GET",
                    undefined,
                    signal,
                  ),
                (file) => load(file.text),
              );
            }}
          >
            <label className="grid flex-1 gap-2 text-sm">
              Workspace file path
              <Input
                required
                maxLength={4096}
                value={sourcePath}
                disabled={busy}
                onChange={(event) => setSourcePath(event.target.value)}
                placeholder="/inputs/source.json"
              />
            </label>
            <Button variant="outline" disabled={busy}>
              Load file
            </Button>
          </form>
          <label className="grid gap-2 text-sm">
            Local UTF-8 file (up to 256 KiB)
            <Input
              type="file"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file || saveRef.current.busy) return;
                setResult(null);
                setErrorLane("read");
                void reader.run(async () => {
                  if (file.size > 262144)
                    throw new Error(
                      "Local file exceeds 256 KiB. Choose a smaller file.",
                    );
                  return decodeEditableText(await file.arrayBuffer());
                }, load);
              }}
            />
          </label>
        </div>
      </details>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Inputs stay in this tab. Only explicit workspace loads and saves use
          the network.
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            change(() => {
              setInput(spec.example);
              setSecondary(spec.extra ?? "");
              setOptions(defaults(id));
            })
          }
        >
          Replace inputs with example
        </Button>
      </div>
      <label className="grid gap-2 text-sm font-medium">
        {spec.input ??
          (group === "record-preparation" ? "JSON array" : "Source CSV")}
        <Textarea
          rows={7}
          maxLength={262144}
          value={input}
          disabled={busy}
          onChange={(event) => change(() => setInput(event.target.value))}
          spellCheck={false}
        />
      </label>
      {spec.secondary ? (
        <label className="grid gap-2 text-sm font-medium">
          {spec.secondary}
          <Textarea
            rows={5}
            maxLength={262144}
            disabled={busy}
            value={secondary}
            onChange={(event) => change(() => setSecondary(event.target.value))}
            spellCheck={false}
          />
        </label>
      ) : null}
      <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2" disabled={busy}>
        <legend className="sr-only">Preparation options</legend>
        {spec.options.map((option) => (
          <label
            key={option.key}
            className="grid content-start gap-2 text-sm font-medium"
          >
            {option.label}
            {option.choices ? (
              <Select
                aria-label={option.label}
                value={options[option.key]}
                disabled={busy}
                onValueChange={(value) =>
                  change(() => setOptions({ ...options, [option.key]: value }))
                }
              >
                {option.choices.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
            ) : option.multiline ? (
              <Textarea
                rows={3}
                maxLength={4096}
                value={options[option.key]}
                onChange={(event) =>
                  change(() =>
                    setOptions({
                      ...options,
                      [option.key]: event.target.value,
                    }),
                  )
                }
              />
            ) : (
              <Input
                maxLength={4096}
                value={options[option.key]}
                onChange={(event) =>
                  change(() =>
                    setOptions({
                      ...options,
                      [option.key]: event.target.value,
                    }),
                  )
                }
              />
            )}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy}
          aria-label={"Preview " + feature.label.toLowerCase()}
          onClick={() => void generate()}
        >
          {preview.busy ? "Preparing preview…" : "Generate preview"}
        </Button>
        {reader.busy || preview.busy ? (
          <Button
            variant="outline"
            onClick={() => {
              reader.cancel();
              preview.cancel();
            }}
          >
            Cancel {reader.busy ? "loading" : "preview"}
          </Button>
        ) : null}
        <p role="status" className="text-xs text-muted-foreground">
          {saveState.busy
            ? "Creating file… Inputs stay locked until the save finishes."
            : reader.busy
              ? "Loading source…"
              : "256 KiB per input/output · JSON: 10,000 values / 40 levels · CSV: 5,000 rows / 200 columns"}
        </p>
      </div>
      {(
        errorLane === "read"
          ? reader.error
          : errorLane === "preview"
            ? preview.error
            : ""
      ) ? (
        <Alert variant="destructive">
          <AlertDescription>
            {errorLane === "read" ? reader.error : preview.error}
          </AlertDescription>
        </Alert>
      ) : null}
      {result ? (
        <div className="space-y-5">
          <PreparationReview result={result} />
          <AgentOutput
            key={result.output}
            result={result}
            contentType={preparationContentType(result.filename)}
            onSaveStateChange={saveChanged}
          />
          {group !== "document-preparation" &&
          id !== "record-audit" &&
          id !== "table-reconcile" ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => change(() => setInput(result.output))}
            >
              Use output as source
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Choose a task, paste or load inputs, then preview. Results appear here
          for review before export.
        </p>
      )}
      {!result && saveState.notice ? (
        <p role="status">{saveState.notice}</p>
      ) : null}
      {!result && saveState.error ? (
        <Alert variant="destructive">
          <AlertDescription>{saveState.error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}

export function RecordPreparation() {
  return <DataPreparationWorkbench group="record-preparation" />;
}
export function TablePreparation() {
  return <DataPreparationWorkbench group="table-preparation" />;
}
export function DocumentPreparation() {
  return <DataPreparationWorkbench group="document-preparation" />;
}
