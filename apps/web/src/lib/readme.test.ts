import { describe, it, expect } from "vitest";
import { chooseReadme, readmeBlocks } from "./readme";
describe("folder README", () => {
  it("prefers Markdown and ignores folders", () =>
    expect(
      chooseReadme([
        { name: "README.txt", path: "/README.txt", kind: "file" },
        { name: "ReadMe.md", path: "/ReadMe.md", kind: "file" },
        { name: "README", path: "/README", kind: "folder" },
      ])?.path,
    ).toBe("/ReadMe.md"));
  it("keeps HTML and links as inert text and recognizes code", () =>
    expect(
      readmeBlocks("# Hello\n<script>x</script>\n```html\n<img src=x>\n```"),
    ).toEqual([
      { kind: "heading", level: 1, text: "Hello" },
      { kind: "paragraph", text: "<script>x</script>" },
      { kind: "code", text: "<img src=x>" },
    ]));
  it("bounds line rendering", () =>
    expect(() => readmeBlocks("\n".repeat(5001))).toThrow());
});
