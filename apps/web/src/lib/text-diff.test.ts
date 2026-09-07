import { describe, it, expect } from "vitest";
import { compareText } from "./text-diff";
describe("bounded text comparison", () => {
  it("aligns unchanged lines between independent edits", () => {
    const d = compareText("a\nb\nc\nd", "A\nb\nC\nd");
    expect(d.added).toBe(2);
    expect(d.removed).toBe(2);
    expect(d.lines.filter((l) => l.kind === "same").map((l) => l.text)).toEqual(
      ["b", "d"],
    );
  });
  it("handles empty files and optional whitespace normalization", () => {
    expect(compareText("", "x").added).toBe(1);
    expect(compareText(" a  b ", "a b", true).removed).toBe(0);
    expect(compareText("a\n", "a").removed).toBe(1);
  });
  it("bounds quadratic work", () =>
    expect(() => compareText("a\n".repeat(1100), "b\n".repeat(1100))).toThrow(
      "million",
    ));
});
