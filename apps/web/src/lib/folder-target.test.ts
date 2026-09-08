import { expect, it } from "vitest";
import { folderTarget } from "./folder-target";
it("normalizes root, separators and spaces like AGFS", () => {
  expect(folderTarget("///")).toBe("/");
  expect(folderTarget("/ reports //2026/ ")).toBe("/reports/2026");
  expect(folderTarget("/release notes/%20")).toBe("/release notes/%20");
});
it("rejects relative segments, control characters and oversized paths", () => {
  for (const value of [
    "reports",
    "/../x",
    "/ . /x",
    "/a\\b",
    "/a\n",
    "/" + "a".repeat(4096),
  ])
    expect(() => folderTarget(value)).toThrow();
});
