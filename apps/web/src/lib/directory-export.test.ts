import { expect, it } from "vitest";
import type { FsEntry } from "@agfs/contracts";
import { directoryExport } from "./directory-export";
import { parseCsv } from "./csv-inspector";
const entry: FsEntry = {
  id: "entry",
  ownerId: "private-owner",
  parentPath: "/",
  path: "/=sum",
  name: "=sum",
  kind: "file",
  size: 0,
  contentType: "text/plain",
  etag: '"abc"',
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
};
it("exports metadata without owner identifiers and preserves null/zero", () => {
  const value = JSON.parse(
    directoryExport(
      [entry, { ...entry, kind: "folder", size: null }],
      "/",
      "json",
      "now",
    ),
  );
  expect(value.count).toBe(2);
  expect(value.entries[0].bytes).toBe(0);
  expect(value.entries[1].bytes).toBe(null);
  expect(value.entries[0]).not.toHaveProperty("ownerId");
  expect(value.exportedAt).toBe("now");
});
it("quotes CSV fields and prevents spreadsheet formula execution", () => {
  const rows = parseCsv(directoryExport([entry], "/", "csv"));
  expect(rows[1][0]).toBe("'=sum");
  expect(rows[1][5]).toBe('"abc"');
  expect(rows[1][3]).toBe("0");
});
it("handles empty directories and refuses excess entries", () => {
  expect(JSON.parse(directoryExport([], "/", "json")).count).toBe(0);
  expect(() => directoryExport(Array(10001).fill(entry), "/", "csv")).toThrow();
});
