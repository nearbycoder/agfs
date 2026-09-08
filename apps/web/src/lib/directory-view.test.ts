import { describe, expect, it } from "vitest";
import { directoryView } from "./directory-view";
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
