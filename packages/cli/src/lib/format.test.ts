import { describe, expect, it } from "vitest";
import { renderEntries, renderTree } from "./format";

describe("renderEntries", () => {
  it("renders a tabular listing", () => {
    expect(
      renderEntries([
        {
          id: "1",
          ownerId: "user_1",
          parentPath: "/",
          path: "/shots",
          name: "shots",
          kind: "folder",
          size: null,
          contentType: null,
          etag: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    ).toContain("/shots\tfolder\tfolder");
  });
});

describe("renderTree", () => {
  it("renders nested branches", () => {
    expect(
      renderTree([
        {
          id: "folder_1",
          path: "/shots",
          name: "shots",
          kind: "folder",
          size: null,
          children: [
            {
              id: "file_1",
              path: "/shots/a.png",
              name: "a.png",
              kind: "file",
              size: 128,
            },
          ],
        },
      ]),
    ).toContain("shots/");
  });
});
