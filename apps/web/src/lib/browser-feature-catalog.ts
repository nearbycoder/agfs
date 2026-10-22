/** Discovery metadata only; processing and examples load with the workbench. */
export const browserFeatures = [
  {
    number: 71,
    id: "record-project",
    group: "record-preparation",
    label: "Project JSON fields",
    description: "Map nested fields into a clean record shape.",
  },
  {
    number: 72,
    id: "record-dedupe",
    group: "record-preparation",
    label: "Deduplicate JSON records",
    description: "Keep the first or last record for an exact key.",
  },
  {
    number: 73,
    id: "record-group",
    group: "record-preparation",
    label: "Group JSON records",
    description: "Collect records into exact scalar-key buckets.",
  },
  {
    number: 74,
    id: "record-sort",
    group: "record-preparation",
    label: "Sort JSON records",
    description: "Order scalar fields without rounding large numbers.",
  },
  {
    number: 75,
    id: "record-index",
    group: "record-preparation",
    label: "Index JSON records",
    description: "Create a lookup object from unique string keys.",
  },
  {
    number: 76,
    id: "record-patch",
    group: "record-preparation",
    label: "Preview JSON Patch",
    description:
      "Review sequential add, remove, replace, copy, move, and test operations.",
  },
  {
    number: 77,
    id: "record-audit",
    group: "record-preparation",
    label: "Audit a record contract",
    description: "Check required fields and JSON types before a handoff.",
  },
  {
    number: 78,
    id: "table-sort",
    group: "table-preparation",
    label: "Sort CSV rows",
    description: "Order text or exact decimal values with stable ties.",
  },
  {
    number: 79,
    id: "table-dedupe",
    group: "table-preparation",
    label: "Deduplicate CSV rows",
    description: "Choose composite columns and retain deterministic survivors.",
  },
  {
    number: 80,
    id: "table-group",
    group: "table-preparation",
    label: "Summarize CSV groups",
    description: "Count rows and calculate exact decimal sums.",
  },
  {
    number: 81,
    id: "table-unpivot",
    group: "table-preparation",
    label: "Reshape wide CSV to long",
    description: "Turn measure columns into portable field/value records.",
  },
  {
    number: 82,
    id: "table-append",
    group: "table-preparation",
    label: "Append CSV by schema",
    description:
      "Combine tables by header name, even when columns are reordered.",
  },
  {
    number: 83,
    id: "table-rename",
    group: "table-preparation",
    label: "Map CSV headers",
    description: "Rename headers with collision checks before export.",
  },
  {
    number: 84,
    id: "table-reconcile",
    group: "table-preparation",
    label: "Reconcile CSV versions",
    description: "Review added, removed, and changed rows by unique key.",
  },
  {
    number: 85,
    id: "document-links",
    group: "document-preparation",
    label: "Inventory Markdown links",
    description: "Review inline link targets without opening or fetching them.",
  },
  {
    number: 86,
    id: "document-tasks",
    group: "document-preparation",
    label: "Extract Markdown tasks",
    description:
      "Collect open and completed tasks with their source locations.",
  },
  {
    number: 87,
    id: "document-redact",
    group: "document-preparation",
    label: "Redact literal text",
    description: "Mask configured literals and review replacement counts.",
  },
] as const;
export type BrowserFeatureId = (typeof browserFeatures)[number]["id"];
export type BrowserFeatureGroup = (typeof browserFeatures)[number]["group"];
export const featureGroup = (id: string) =>
  browserFeatures.find((feature) => feature.id === id)?.group;
