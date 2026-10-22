import { describe, expect, it, vi } from "vitest";
import {
  directoryView,
  prepareDirectory,
  filterDirectory,
} from "./directory-view";
const entries = [
  {
    name: "file10",
    path: "/a/file10",
    kind: "file",
    size: 2,
    updatedAt: "2026-01-02",
  },
  {
    name: "file2",
    path: "/a/file2",
    kind: "file",
    size: 10,
    updatedAt: "2026-01-01",
  },
  { name: "Z", path: "/a/Z", kind: "folder" },
];
describe("directory browsing", () => {
  it("sorts naturally with folders first without mutating source", () => {
    expect(directoryView(entries, "", "", "name").map((e) => e.name)).toEqual([
      "Z",
      "file2",
      "file10",
    ]);
    expect(entries[0].name).toBe("file10");
  });
  it("combines case-insensitive paths and kinds", () =>
    expect(
      directoryView(entries, "/A/FILE", "file", "size").map((e) => e.name),
    ).toEqual(["file2", "file10"]));
  it("supports descending names, dates and no matches", () => {
    expect(directoryView(entries, "", "file", "name-desc")[0].name).toBe(
      "file10",
    );
    expect(directoryView(entries, "", "file", "updated")[0].name).toBe(
      "file10",
    );
    expect(directoryView(entries, "missing", "", "name")).toEqual([]);
  });
});

describe("reusable directory snapshot", () => {
  it("normalizes dates once for a 10,000-entry directory and does no date work during queries", () => {
    const many = Array.from({ length: 10000 }, (_, index) => ({
      name: `file${index}`,
      path: `/folder/file${index}`,
      kind: "file",
      size: index,
      updatedAt: "2026-10-22T10:00:00Z",
    }));
    const parse = vi.spyOn(Date, "parse");
    try {
      const prepared = prepareDirectory(many, "updated");
      expect(parse).toHaveBeenCalledTimes(10000);
      parse.mockClear();
      expect(
        filterDirectory(prepared, " FILE99 ", "file").map(
          (entry) => entry.name,
        ),
      ).toEqual(
        many
          .filter((entry) => entry.name.includes("file99"))
          .map((entry) => entry.name),
      );
      expect(filterDirectory(prepared, "/FOLDER/FILE9999", "file")).toEqual([
        many[9999],
      ]);
      expect(filterDirectory(prepared, "", "folder")).toEqual([]);
      expect(parse).not.toHaveBeenCalled();
      expect(prepared.totalBytes).toBe(49995000);
      expect(prepared.fileCount).toBe(10000);
      expect(prepared.byPath.get(many[9999].path)).toBe(many[9999]);
    } finally {
      parse.mockRestore();
    }
  });

  it("rebuilds from fresh entries without retaining a previous workspace's data", () => {
    const first = prepareDirectory(entries, "size");
    const revised = [{ ...entries[0], size: 999, name: "new" }];
    const second = prepareDirectory(revised, "size");
    expect(filterDirectory(second, "file", "")).toEqual(revised); // path still matches
    expect(second.byPath.has("/a/file2")).toBe(false);
    expect(second.totalBytes).toBe(999);
    expect(first.totalBytes).toBe(12);
    expect(second.folderCount).toBe(0);
  });

  it("preserves folders-first and stable ties across filters without changing source order", () => {
    const source = [
      ...entries,
      { name: "file2", path: "/b/file2", kind: "file", size: 10 },
    ];
    const prepared = prepareDirectory(source, "size");
    expect(
      filterDirectory(prepared, "", "").map((entry) => entry.path),
    ).toEqual(["/a/Z", "/a/file2", "/b/file2", "/a/file10"]);
    expect(filterDirectory(prepared, "/b/", "file")).toEqual([source[3]]);
    expect(source[0]).toBe(entries[0]);
  });
});
