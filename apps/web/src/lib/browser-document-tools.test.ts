import { describe, expect, it } from "vitest";
import { linkKind, runDocumentTool } from "./browser-document-tools";
const run = (
  id: string,
  source: string,
  extra = "",
  options: Record<string, string> = {},
) => runDocumentTool("document-" + id, source, extra, options);
describe("document handoff preparation", () => {
  it("#85 inventories supported links/images without code or reference links", () => {
    const source =
      "# Doc\n[Guide](./guide.md)\n![Plot](https://example.test/a.png)\n`[code](javascript:no)`\n```md\n[no](./hidden)\n```\n    [indented](./no)\n[reference][r]\n[r]: ./reference\n[Alert](javascript:alert)\n";
    const result = run("links", source, "", { filter: "all" });
    expect(result.rows).toEqual([
      ["2", "link", "Guide", "./guide.md", "relative"],
      ["3", "image", "Plot", "https://example.test/a.png", "https"],
      ["11", "link", "Alert", "javascript:alert", "unsafe scheme"],
    ]);
    expect(JSON.parse(result.output).links).toHaveLength(3);
  });
  it("#85 reports unsupported candidates and supports a review filter", () => {
    const result = run(
      "links",
      '[secure](https://example.test) [plain](http://example.test) [network](//example.test) [nested](https://e.test/a(b)) [title](https://e.test "title")',
      "",
      { filter: "review" },
    );
    expect(result.rows?.map((r) => r[2])).toEqual(["plain", "network"]);
    expect(JSON.parse(result.output).unsupportedCandidates).toBe(2);
  });
  it("#85 classifies control characters/entities and never renders targets as links", () => {
    expect(linkKind("javascript:alert(1)")).toBe("unsafe scheme");
    expect(linkKind("java&#115;cript:alert")).toBe("review");
    expect(linkKind("data:text/plain,test")).toBe("unsafe scheme");
    expect(linkKind("https://")).toBe("review");
    expect(linkKind("#heading")).toBe("anchor");
    expect(linkKind("mailto:a@example.test")).toBe("email");
  });
  it("#86 extracts statuses, original line numbers, headings, numbered lists and fence rules", () => {
    const source =
      "# Release\n- [ ] open\n* [X] done\n## Next\n1. [x] numbered\n~~~md\n- [ ] hidden\n```\n- [ ] still hidden\n~~~\n+ [ ] visible\n    - [ ] indented\n";
    const result = run("tasks", source, "", { status: "all" });
    expect(result.rows).toEqual([
      ["2", "open", "Release", "open"],
      ["3", "complete", "Release", "done"],
      ["5", "complete", "Next", "numbered"],
      ["11", "open", "Next", "visible"],
    ]);
    expect(run("tasks", source, "", { status: "open" }).rows).toHaveLength(2);
    expect(run("tasks", source, "", { status: "complete" }).rows).toHaveLength(
      2,
    );
    expect(run("tasks", "No tasks", "", { status: "all" }).rows).toEqual([]);
  });
  it("#87 resolves overlapping literals by longest match, without regex or replacement recursion", () => {
    const rules =
      '[{"name":"account","literal":"ACCT-123"},{"name":"prefix","literal":"ACCT"},{"name":"dollar","literal":"$&"}]';
    const result = run("redact", "ACCT-123 ACCT $& ACCT-123", rules);
    expect(result.output).toBe(
      "[REDACTED:account] [REDACTED:prefix] [REDACTED:dollar] [REDACTED:account]",
    );
    expect(result.rows).toEqual([
      ["account", "2"],
      ["prefix", "1"],
      ["dollar", "1"],
    ]);
    expect(run("redact", "a", '[{"name":"a","literal":"a"}]').output).toBe(
      "[REDACTED:a]",
    );
  });
  it("#87 handles Unicode, preserves unmatched text, and does not include literals in the report", () => {
    const result = run(
      "redact",
      "hello 🔑你好 and public",
      '[{"name":"key","literal":"🔑你好"},{"name":"unused","literal":"private"}]',
    );
    expect(result.output).toBe("hello [REDACTED:key] and public");
    expect(result.rows).toEqual([
      ["key", "1"],
      ["unused", "0"],
    ]);
    expect(result.summary).not.toContain("private");
  });
  it("#87 rejects ambiguous/empty/oversized rules and adversarial prefix work", () => {
    expect(() => run("redact", "a", '[{"name":"x","literal":""}]')).toThrow(
      "nonempty",
    );
    expect(() =>
      run(
        "redact",
        "a",
        '[{"name":"x","literal":"a"},{"name":"y","literal":"a"}]',
      ),
    ).toThrow("unique");
    expect(() =>
      run(
        "redact",
        "a",
        '[{"name":"x","literal":"a"},{"name":"x","literal":"b"}]',
      ),
    ).toThrow("unique");
    expect(() =>
      run(
        "redact",
        "a".repeat(20000),
        JSON.stringify([{ name: "long", literal: "a".repeat(1000) + "b" }]),
      ),
    ).toThrow("work limit");
    expect(() =>
      run("redact", "a".repeat(30000), '[{"name":"expanded","literal":"a"}]'),
    ).toThrow("256 KiB");
  });
  it.each([
    ["LF", ["\n"]],
    ["CRLF", ["\r\n"]],
    ["CR", ["\r"]],
    ["mixed", ["\r\n", "\n", "\r"]],
  ])(
    "#87 allows 10,000 %s lines and refuses 10,001 without changing newlines",
    (_, separators) => {
      const rules = '[{"name":"test","literal":"absent"}]';
      const source = Array.from(
        { length: 9999 },
        (_, i) => "kept" + separators[i % separators.length],
      ).join("");
      // A trailing newline introduces the final empty line, just as split does.
      expect(source.split(/\r\n|\r|\n/)).toHaveLength(10000);
      expect(run("redact", source, rules).output).toBe(source);
      expect(() =>
        run("redact", source + "kept" + separators[0], rules),
      ).toThrow("10,000 lines");
    },
  );
  it("#87 keeps non-CR/LF Unicode separators as text and preserves the existing byte/work bounds", () => {
    const rules = '[{"name":"test","literal":"absent"}]';
    const unicode = "\u2028\u2029".repeat(10000);
    expect(run("redact", unicode, rules).output).toBe(unicode);
    const maximum = "z".repeat(262144);
    expect(run("redact", maximum, rules).output).toBe(maximum);
    expect(() => run("redact", maximum + "z", rules)).toThrow("256 KiB");
  });
  it("bounds bytes, document lines and findings without silent truncation", () => {
    expect(() =>
      run("tasks", "\n".repeat(10000), "", { status: "all" }),
    ).toThrow("10,000 lines");
    expect(() =>
      run("tasks", "- [ ] task\n".repeat(1001), "", { status: "all" }),
    ).toThrow("1,000 matching");
    expect(() =>
      run("links", "é".repeat(140000), "", { filter: "all" }),
    ).toThrow("256 KiB");
  });
});
