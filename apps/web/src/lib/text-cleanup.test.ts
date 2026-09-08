import { expect, it } from "vitest";
import { cleanText, type CleanupOptions } from "./text-cleanup";
const defaults: CleanupOptions = {
  trimTrailing: false,
  tabs: "keep",
  blankLines: "keep",
  lineEndings: "preserve",
  finalNewline: "preserve",
};
it("preserves exact source when no recipes are enabled", () => {
  const source = "a\t \r\nb\n\n";
  expect(cleanText(source, defaults)).toBe(source);
});
it("normalizes endings, tabs and trailing whitespace explicitly", () =>
  expect(
    cleanText("a\t \r\n\tb\t\r", {
      ...defaults,
      trimTrailing: true,
      tabs: "2",
      lineEndings: "lf",
      finalNewline: "ensure",
    }),
  ).toBe("a\n  b\n"));
it("collapses or removes blank lines without changing nonempty content", () => {
  expect(
    cleanText("a\n\n \n\nb\n", { ...defaults, blankLines: "collapse" }),
  ).toBe("a\n\nb\n");
  expect(cleanText("\na\n\nb", { ...defaults, blankLines: "remove" })).toBe(
    "a\nb",
  );
});
it("guards expanded output and can remove final newlines", () => {
  expect(() =>
    cleanText("\t".repeat(70000), { ...defaults, tabs: "4" }),
  ).toThrow();
  expect(cleanText("a\r\n\r\n", { ...defaults, finalNewline: "remove" })).toBe(
    "a",
  );
});
