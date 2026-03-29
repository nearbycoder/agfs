import { describe, expect, it } from "vitest";
import { summarizeFolderDownload } from "./progress";

describe("summarizeFolderDownload", () => {
  it("uses the singular noun for one file", () => {
    expect(summarizeFolderDownload(1, "./downloads")).toBe("Downloaded 1 file into ./downloads");
  });

  it("uses the plural noun for multiple files", () => {
    expect(summarizeFolderDownload(3, "./downloads")).toBe("Downloaded 3 files into ./downloads");
  });
});
