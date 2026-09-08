import { describe, it, expect } from "vitest";
import { releaseHandoff } from "./release-handoff";
const file = {
  path: "/x.md",
  name: "x.md",
  size: 3,
  contentType: "text/plain",
  etag: "rev1",
};
describe("Release handoffs", () => {
  it("includes artifacts and annotations without creating public links", () => {
    const text = releaseHandoff("Release", "Ready", [file], {
      "/x.md": "Reviewed",
    });
    expect(text).toContain("Revision: rev1");
    expect(text).toContain("Reviewed");
    expect(text).not.toContain("https://");
  });
  it("escapes Markdown and HTML supplied by file names or notes", () => {
    const text = releaseHandoff(
      "<img>",
      "[click](https://evil)",
      [{ ...file, name: "# bad" }],
      {},
    );
    expect(text).toContain("&lt;img&gt;");
    expect(text).toContain("\\[click\\]");
    expect(text).toContain("### \\# bad");
  });
  it("bounds titles and selections", () => {
    expect(() => releaseHandoff("", "", [file], {})).toThrow();
    expect(() =>
      releaseHandoff("Release", "", Array(51).fill(file), {}),
    ).toThrow();
  });
});
