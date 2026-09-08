import { expect, it } from "vitest";
import { textReplacement } from "./text-replace";
it("matches literal punctuation and preserves replacement dollar sequences", () =>
  expect(textReplacement("a.b aXb a.b", "a.b", "$&").output).toBe("$& aXb $&"));
it("supports case and Unicode word boundaries", () => {
  expect(
    textReplacement("Cat cat caterpillar", "cat", "dog", false, true).output,
  ).toBe("dog dog caterpillar");
  expect(textReplacement("猫 猫咪", "猫", "犬", true, true).output).toBe(
    "犬 猫咪",
  );
});
it("counts matches, bounds previews, and supports deletion", () => {
  const r = textReplacement("a ".repeat(10), "a", "");
  expect(r.count).toBe(10);
  expect(r.samples).toHaveLength(5);
  expect(r.output).toBe(" ".repeat(10));
});
it("prevents oversized output and unbounded matches", () => {
  expect(() => textReplacement("x".repeat(10001), "x", "a")).toThrow();
  expect(() =>
    textReplacement("x".repeat(1000), "x", "界".repeat(100)),
  ).toThrow();
  expect(textReplacement("unchanged", "", "").count).toBe(0);
});
