import { describe, it, expect } from "vitest";
import { fileSearchCommands } from "./command-search";
describe("Command file results", () => {
  it("navigates files to their folder and folders to themselves", () => {
    expect(
      fileSearchCommands([
        { path: "/a/report #1.txt", kind: "file" },
        { path: "/a/b", kind: "folder" },
      ]).map((c) => c.href),
    ).toEqual(["/app/files?path=%2Fa", "/app/files?path=%2Fa%2Fb"]);
    expect(fileSearchCommands([{ path: "/x", kind: "file" }])[0].href).toBe(
      "/app/files?path=%2F",
    );
  });
  it("rejects invalid result shapes and bounds the menu", () => {
    expect(
      fileSearchCommands([
        null,
        { path: "https://evil", kind: "file" },
        { path: "/x\n", kind: "folder" },
      ]),
    ).toEqual([]);
    expect(
      fileSearchCommands(Array(30).fill({ path: "/a", kind: "file" })),
    ).toHaveLength(20);
  });
});
