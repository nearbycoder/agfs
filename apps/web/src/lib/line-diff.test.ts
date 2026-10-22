import { expect, it } from "vitest";
import { lineDiffPage, prepareLineDiff } from "./line-diff";

it("preserves unchanged context and original line numbers around changes", () => {
  const model = prepareLineDiff("header\nold\ntail\n", "header\nnew\ntail\n");
  expect(lineDiffPage(model, 0).rows).toEqual([
    { sign: " ", line: 1, text: "header" },
    { sign: "−", line: 2, text: "old" },
    { sign: "+", line: 2, text: "new" },
    { sign: " ", line: 3, text: "tail" },
    { sign: " ", line: 4, text: "" },
  ]);
});

it("makes every change reachable while bounding each page to 100 rows", () => {
  const before = Array.from({ length: 4000 }, (_, i) => `old ${i + 1}`);
  const after = Array.from({ length: 4000 }, (_, i) => `new ${i + 1}`);
  const model = prepareLineDiff(before.join("\n"), after.join("\n"));
  const first = lineDiffPage(model, 0);
  expect(first.pages).toBe(80);
  const rows = Array.from({ length: first.pages }, (_, page) => {
    const result = lineDiffPage(model, page);
    expect(result.rows.length).toBeLessThanOrEqual(100);
    return result.rows;
  }).flat();
  expect(rows.filter((row) => row.sign === "−").map((row) => row.text)).toEqual(
    before,
  );
  expect(rows.filter((row) => row.sign === "+").map((row) => row.text)).toEqual(
    after,
  );
  expect(rows.at(-1)).toEqual({ sign: "+", line: 4000, text: "new 4000" });
  expect(lineDiffPage(model, 999).page).toBe(79);
  expect(lineDiffPage(model, -1).page).toBe(0);
  expect(lineDiffPage(model, NaN).page).toBe(0);
});

it("keeps unchanged documents compact and handles empty/deleted files", () => {
  expect(
    lineDiffPage(prepareLineDiff("a\nb\nc\nd\ne", "a\nb\nc\nd\ne"), 0).rows,
  ).toEqual(
    [3, 4, 5].map((line) => ({
      sign: " ",
      line,
      text: ["a", "b", "c", "d", "e"][line - 1],
    })),
  );
  expect(lineDiffPage(prepareLineDiff("", ""), 0).rows).toEqual([
    { sign: " ", line: 1, text: "" },
  ]);
  expect(
    lineDiffPage(prepareLineDiff("old", ""), 0).rows.map((row) => row.sign),
  ).toEqual(["−", "+"]);
});
