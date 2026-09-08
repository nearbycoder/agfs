import { describe, it, expect } from "vitest";
import { markdownDocument } from "./markdown-reader";
describe("Markdown reading room", () => {
  it("builds outline without treating fenced headings as headings", () => {
    const d = markdownDocument(
      "# Title\nhello world\n```\n# code\n```\n## Next",
    );
    expect(d.headings.map((h) => h.text)).toEqual(["Title", "Next"]);
    expect(d.codeBlocks).toBe(1);
    expect(d.words).toBe(4);
  });
  it("keeps hostile markup as inert text", () => {
    expect(markdownDocument("<script>alert(1)</script>").blocks[0].text).toBe(
      "<script>alert(1)</script>",
    );
  });
  it("bounds source and rendered blocks", () => {
    expect(() => markdownDocument("x".repeat(262145))).toThrow();
    expect(() => markdownDocument("x\n".repeat(1501))).toThrow();
  });
});
