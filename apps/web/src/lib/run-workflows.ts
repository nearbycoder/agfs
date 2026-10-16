import { z } from "zod";
export const runMetadataSchema = z.record(
  z.string().min(1).max(80),
  z.string().max(1000),
);
export function parseRunMetadata(source: string) {
  const value = runMetadataSchema.parse(JSON.parse(source));
  if (
    Object.keys(value).length > 30 ||
    new TextEncoder().encode(JSON.stringify(value)).length > 8192
  )
    throw new Error("Use up to 30 metadata fields and 8 KiB of metadata.");
  return value;
}
export type RunListItem = {
  id: string;
  name: string;
  path_prefix: string;
  status: string;
  created_at: number;
  completed_at?: number | null;
  metadata: string;
};
export function filterRuns<T extends RunListItem>(
  runs: T[],
  query: string,
  status: string,
) {
  const needle = query.trim().toLowerCase();
  return runs.filter(
    (r) =>
      (!status || r.status === status) &&
      `${r.name} ${r.path_prefix} ${r.id} ${r.metadata}`
        .toLowerCase()
        .includes(needle),
  );
}
const artifactSchema = z.object({
  path: z.string(),
  size: z.number().nonnegative().nullable().optional(),
  etag: z.string().nullable().optional(),
  checksum: z.string().nullable().optional(),
});
const manifestSchema = z.object({
  runId: z.string(),
  name: z.string(),
  completedAt: z.string(),
  retainedUntil: z.string(),
  metadata: runMetadataSchema.default({}),
  inputs: z.array(artifactSchema).max(50),
  artifacts: z.array(artifactSchema).max(200),
});
const md = (value: string) =>
  value
    .replace(/[\\`*_{}\[\]()#+.!|<>~-]/g, "\\$&")
    .replace(/\r\n|\r|\n/g, " ");
export function runReport(input: unknown) {
  const manifest = manifestSchema.parse(input);
  const table = (files: z.infer<typeof artifactSchema>[]) =>
    [
      "| Path | Bytes | Version ETag | SHA-256 |",
      "| --- | ---: | --- | --- |",
      ...files.map(
        (f) =>
          `| ${md(f.path)} | ${f.size ?? "—"} | ${md(f.etag ?? "—")} | ${md(f.checksum ?? "Unavailable")} |`,
      ),
    ].join("\n");
  return [
    "# " + md(manifest.name),
    "",
    "Run: " + md(manifest.runId),
    "Completed: " + md(manifest.completedAt),
    "Retained until: " + md(manifest.retainedUntil),
    "",
    "## Metadata",
    "",
    ...Object.entries(manifest.metadata).map(
      ([k, v]) => "- " + md(k) + ": " + md(v),
    ),
    "",
    "## Inputs",
    "",
    table(manifest.inputs),
    "",
    "## Outputs",
    "",
    table(manifest.artifacts),
    "",
  ].join("\n");
}
export function runInputSelection(paths: string[]) {
  if (
    !paths.length ||
    paths.length > 50 ||
    new Set(paths).size !== paths.length ||
    paths.some((p) => !p.startsWith("/") || p.length > 4096)
  )
    throw new Error("Select 1–50 distinct file paths.");
  const result = JSON.stringify(paths);
  if (result.length > 12000)
    throw new Error(
      "Selected paths are too long for a run shortcut. Use fewer files.",
    );
  return result;
}
export function decodeRunSelection(source?: string) {
  if (!source) return [];
  if (source.length > 12000)
    throw new Error("Run input shortcut is too large.");
  const paths = z
    .array(z.string().startsWith("/").max(4096))
    .min(1)
    .max(50)
    .parse(JSON.parse(source));
  runInputSelection(paths);
  return paths;
}
/** TanStack's search parser may decode JSON query strings into arrays. */
export function normalizeRunSelection(value: unknown): string | undefined {
  return typeof value === "string"
    ? value
    : Array.isArray(value)
      ? JSON.stringify(value)
      : undefined;
}
export function replayRun(
  input: { name: string; id: string; inputs: string; metadata: string },
  at = Date.now(),
) {
  const inputs = z
    .array(artifactSchema)
    .max(50)
    .parse(JSON.parse(input.inputs))
    .map((v) => v.path);
  if (inputs.length) runInputSelection(inputs);
  return {
    name: (input.name + " · rerun").slice(0, 100),
    path: "/runs/" + input.id.replace(/[^a-zA-Z0-9_-]/g, "") + "-" + at,
    inputs: inputs.join("\n"),
    metadata: JSON.stringify(parseRunMetadata(input.metadata), null, 2),
  };
}
