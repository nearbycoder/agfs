import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TextComparisonRows } from "./TextCompare";
import { RunArtifactTable, RunMetadataDisclosure } from "./RunCompare";
import { resultPage } from "./ResultPage";
import { compareText } from "~/lib/text-diff";
import { compareArtifacts } from "~/lib/run-comparison";

afterEach(() => vi.restoreAllMocks());

it("#36 bounds text-comparison rendering and keeps all 2,000 lines reachable", () => {
  const lines = compareText(
    Array(1000).fill("before").join("\n"),
    Array(1000).fill("after").join("\n"),
  ).lines;
  const html = renderToStaticMarkup(<TextComparisonRows lines={lines} />);
  expect(html.match(/class="flex gap-3 whitespace-pre /g)).toHaveLength(100);
  expect(html).toContain('aria-label="compared lines pages"');
  expect(html).toContain("Page 1 of 20");
  expect(
    Array.from({ length: 20 }, (_, i) => resultPage(lines, i).rows).flat(),
  ).toEqual(lines);
  expect(resultPage(lines, 999).page).toBe(19);
  expect(resultPage([], 19).page).toBe(0);
});
it("#37 renders at most 100 manifest entries, including complete filtered results", () => {
  const source = Array.from({ length: 2000 }, (_, i) => ({
    path: "/file-" + String(i).padStart(4, "0"),
    size: i,
    etag: "a",
  }));
  const rows = compareArtifacts(
    source,
    source.map((r, i) => (i % 2 ? { ...r, etag: "b" } : r)),
  );
  const html = renderToStaticMarkup(
    <RunArtifactTable title="Outputs" rows={rows} onlyChanges={false} />,
  );
  expect(html.match(/<tr\b/g)).toHaveLength(101);
  expect(html).toContain("Page 1 of 20");
  expect(html).not.toContain("/file-0100");
  const filtered = renderToStaticMarkup(
    <RunArtifactTable title="Outputs" rows={rows} onlyChanges />,
  );
  expect(filtered.match(/<tr\b/g)).toHaveLength(101);
  expect(filtered).toContain("Page 1 of 10");
  expect(filtered).not.toContain("/file-0000");
  expect(
    Array.from({ length: 20 }, (_, i) => resultPage(rows, i).rows).flat(),
  ).toEqual(rows);
});
it("#37 does no serialization for unopened run metadata", () => {
  const stringify = vi.spyOn(JSON, "stringify");
  const value = { private: "x".repeat(200000) };
  const html = renderToStaticMarkup(<RunMetadataDisclosure value={value} />);
  expect(stringify.mock.calls.filter((args) => args[0] === value)).toHaveLength(
    0,
  );
  expect(html).not.toContain("private");
});
