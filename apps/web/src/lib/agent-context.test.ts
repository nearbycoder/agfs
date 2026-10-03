import { describe, expect, it } from "vitest";
import {
  boundedAgentText,
  chunkContext,
  contextPack,
  promptVariables,
} from "./agent-context";
describe("bounded agent context", () => {
  it("renders literal variables once and rejects missing or non-string values", () => {
    expect(
      promptVariables(
        "Hi {{ name }}, {{task}}",
        '{"name":"{{task}}","task":"$&"}',
      ),
    ).toBe("Hi {{task}}, $&");
    expect(() => promptVariables("{{missing}}", "{}")).toThrow(
      "Missing variables",
    );
    expect(() => promptVariables("{{n}}", '{"n":1}')).toThrow(
      "must be a string",
    );
    expect(() => promptVariables("{{x}}", "[]")).toThrow("object");
  });
  it("chunks whole lines with progressing overlap and correct ranges", () => {
    const chunks = chunkContext(
      Array.from({ length: 10 }, (_, i) => String(i).repeat(30)).join("\n"),
      100,
      1,
    );
    expect(chunks.map((c) => [c.startLine, c.endLine])).toEqual([
      [1, 3],
      [3, 5],
      [5, 7],
      [7, 9],
      [9, 10],
    ]);
    expect(chunks.every((c) => c.text.length <= 100)).toBe(true);
    expect(chunkContext("", 100, 0)).toEqual([]);
    expect(chunkContext("a\nb", 100, 20)).toHaveLength(1);
  });
  it("refuses long indivisible lines and unbounded parameters", () => {
    expect(() => chunkContext("x".repeat(200), 100, 0)).toThrow("line exceeds");
    expect(() => chunkContext("x", 0, 0)).toThrow("chunk size");
    expect(() => chunkContext("x", 100, 21)).toThrow("overlap");
  });
  it("bundles ordered paths and versions without truncation", () => {
    const files = [
      { path: "/b.md", text: "B", etag: "b1" },
      { path: "/a.json", text: "A", etag: "a1" },
    ];
    const pack = contextPack(files, 8000, "Review");
    expect(JSON.parse(pack.output).files).toEqual(files);
    expect(pack.estimatedTokens).toBe(
      Math.ceil(new TextEncoder().encode(pack.output).length / 3),
    );
  });
  it("fails visibly on budget, count, duplicates and UTF-8 byte size", () => {
    expect(() =>
      contextPack([{ path: "/a", text: "x".repeat(3000) }], 100, ""),
    ).toThrow("No content was truncated");
    expect(() =>
      contextPack(Array(21).fill({ path: "/x", text: "" }), 8000, ""),
    ).toThrow("1–20");
    expect(() =>
      contextPack(
        [
          { path: "/a", text: "" },
          { path: "/a", text: "" },
        ],
        8000,
        "",
      ),
    ).toThrow("distinct");
    expect(() => boundedAgentText("😀".repeat(65537))).toThrow("256 KiB");
    expect(() =>
      promptVariables("{{x}}{{x}}", JSON.stringify({ x: "y".repeat(140000) })),
    ).toThrow("256 KiB");
  });
});
