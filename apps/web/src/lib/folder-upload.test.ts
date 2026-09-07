import { describe, it, expect } from "vitest";
import { folderUploadPlan } from "./folder-upload";
const file = { name: "a.txt", webkitRelativePath: "folder/sub/a.txt", size: 3 };
describe("folder upload planning", () => {
  it("preserves selected folder and nested structure", () =>
    expect(folderUploadPlan([file], "/work")[0].path).toBe(
      "/work/folder/sub/a.txt",
    ));
  it("rejects traversal aliases and duplicate paths", () => {
    for (const path of [
      "folder/../a",
      "folder//a",
      "folder/ a",
      "folder/a\\b",
      "folder/a\u0000",
    ])
      expect(() =>
        folderUploadPlan([{ ...file, webkitRelativePath: path }], "/"),
      ).toThrow();
    expect(() => folderUploadPlan([file, file], "/")).toThrow();
  });
  it("bounds file count and supports empty files", () => {
    expect(() => folderUploadPlan(Array(501).fill(file), "/")).toThrow();
    expect(folderUploadPlan([{ ...file, size: 0 }], "/")[0].file.size).toBe(0);
  });
});
