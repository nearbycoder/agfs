/** Metadata only: navigation must not load the workbench's processing code. */
export const agentTools = [
  {
    id: "context-pack",
    label: "Context pack builder",
    group: "Prepare",
    description:
      "Bundle workspace files with instructions and an estimated token budget.",
  },
  {
    id: "context-chunker",
    label: "Context chunker",
    group: "Prepare",
    description:
      "Split long context into numbered chunks with line ranges and overlap.",
  },
  {
    id: "prompt-variables",
    label: "Prompt variable renderer",
    group: "Prepare",
    description:
      "Fill named prompt variables and catch missing inputs before a run.",
  },
  {
    id: "json-merge-patch",
    label: "JSON merge patch",
    group: "Data",
    description:
      "Apply RFC 7396 patches to a preview without changing the source.",
  },
  {
    id: "json-redactor",
    label: "JSON Pointer redaction",
    group: "Prepare",
    description:
      "Remove selected sensitive values from the output you give an agent.",
  },
  {
    id: "json-shape",
    label: "JSON shape profiler",
    group: "Inspect",
    description:
      "Inventory field paths, observed types, and occurrence counts.",
  },
  {
    id: "json-records",
    label: "JSON record selector",
    group: "Data",
    description:
      "Select array records by a nested value, substring, or field presence.",
  },
  {
    id: "array-jsonl",
    label: "JSON array to JSONL",
    group: "Data",
    description:
      "Prepare one exact JSON value per line for batch agent inputs.",
  },
  {
    id: "jsonl-array",
    label: "JSONL to JSON array",
    group: "Data",
    description:
      "Collect agent logs into one array with line-specific validation.",
  },
  {
    id: "csv-project",
    label: "CSV column projection",
    group: "Data",
    description: "Choose and reorder only the columns your agent needs.",
  },
  {
    id: "csv-join",
    label: "CSV keyed join",
    group: "Data",
    description:
      "Enrich records with an inner or left join on a unique lookup key.",
  },
  {
    id: "csv-markdown",
    label: "CSV to Markdown table",
    group: "Prepare",
    description:
      "Turn tabular results into an escaped, readable handoff table.",
  },
  {
    id: "line-sets",
    label: "Line set comparison",
    group: "Inspect",
    description:
      "Find shared, missing, or combined items in two artifact lists.",
  },
  {
    id: "path-scope",
    label: "Path scope tester",
    group: "Inspect",
    description:
      "Preview glob matches before planning which artifacts to process.",
  },
  {
    id: "webhook-verifier",
    label: "Webhook signature verifier",
    group: "Verify",
    description:
      "Check an AGFS HMAC signature and its five-minute timestamp window locally.",
  },
] as const;
export type AgentToolId = (typeof agentTools)[number]["id"];
