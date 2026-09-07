import { describe, it, expect } from "vitest";
import { starterTemplates, renderFileTemplate } from "./template-format";
describe("file template rendering", () => {
  it("substitutes the filename and UTC date", () => {
    expect(
      renderFileTemplate(
        "{{name}} {{date}}",
        "/work/report.md",
        "text/markdown",
        new Date("2026-09-07T01:00:00Z"),
      ),
    ).toBe("report 2026-09-07");
  });
  it("escapes substitutions inside JSON strings", () => {
    const t = starterTemplates.find(
      (t) => t.contentType === "application/json",
    )!;
    expect(
      JSON.parse(renderFileTemplate(t.body, '/a"b.json', t.contentType)).name,
    ).toBe('a"b');
  });
  it("preserves unknown placeholders and does not execute code", () => {
    expect(
      renderFileTemplate(
        "{{unknown}} ${process.exit()}",
        "/file.txt",
        "text/plain",
      ),
    ).toBe("{{unknown}} ${process.exit()}");
  });
});
