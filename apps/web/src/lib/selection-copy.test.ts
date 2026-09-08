import { expect, it } from "vitest";
import { selectionCopy } from "./selection-copy";
it("preserves paths and deduplicates without changing selection order", () => {
  expect(selectionCopy(["/a b", "/x", "/a b"], "lines")).toBe("/a b\n/x");
  expect(JSON.parse(selectionCopy(["/é", "/a'\""], "json"))).toEqual([
    "/é",
    "/a'\"",
  ]);
});
it("quotes shell metacharacters literally", () =>
  expect(selectionCopy(["/a'b", "/$(whoami);*"], "shell")).toBe(
    "'/a'\"'\"'b' '/$(whoami);*'",
  ));
it("rejects invalid and oversized selections", () => {
  expect(() => selectionCopy(["/a\nb"], "lines")).toThrow();
  expect(() => selectionCopy(["/" + "x".repeat(1048576)], "json")).toThrow();
});
