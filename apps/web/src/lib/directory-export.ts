import type { FsEntry } from "@agfs/contracts";
import { csvCell } from "./activity-explorer";
export function directoryExport(
  entries: FsEntry[],
  folder: string,
  format: "json" | "csv",
  now = new Date().toISOString(),
) {
  if (entries.length > 10000)
    throw new Error(
      "Export at most 10,000 entries. Narrow the folder filter first.",
    );
  const rows = entries.map((e) => ({
    name: e.name,
    path: e.path,
    kind: e.kind,
    bytes: e.size,
    contentType: e.contentType,
    etag: e.etag,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
  const value =
    format === "json"
      ? JSON.stringify(
          { folder, exportedAt: now, count: rows.length, entries: rows },
          null,
          2,
        )
      : [
          [
            "Name",
            "Path",
            "Kind",
            "Bytes",
            "Content type",
            "ETag",
            "Created",
            "Updated",
          ],
          ...rows.map((e) =>
            Object.values(e).map((v) => (v === null ? "" : String(v))),
          ),
        ]
          .map((row) => row.map(csvCell).join(","))
          .join("\r\n") + "\r\n";
  if (new TextEncoder().encode(value).length > 8388608)
    throw new Error(
      "The inventory exceeds 8 MiB. Narrow the filter and export again.",
    );
  return value;
}
