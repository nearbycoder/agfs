import { describe, expect, it } from "vitest";
import { flattenTree, getRemoteLeafName, joinRelativeDestination, resolveFolderDestination } from "./download";

describe("getRemoteLeafName", () => {
  it("uses the final segment for normal paths", () => {
    expect(getRemoteLeafName("/screenshots/shot.png")).toBe("shot.png");
    expect(getRemoteLeafName("/screenshots")).toBe("screenshots");
  });

  it("uses agfs-root for root downloads", () => {
    expect(getRemoteLeafName("/")).toBe("agfs-root");
  });
});

describe("flattenTree", () => {
  it("separates directories and files while preserving relative paths", () => {
    const result = flattenTree([
      {
        id: "dir_1",
        path: "/screenshots",
        name: "screenshots",
        kind: "folder",
        size: null,
        children: [
          {
            id: "file_1",
            path: "/screenshots/a.png",
            name: "a.png",
            kind: "file",
            size: 12,
          },
          {
            id: "dir_2",
            path: "/screenshots/nested",
            name: "nested",
            kind: "folder",
            size: null,
            children: [
              {
                id: "file_2",
                path: "/screenshots/nested/b.png",
                name: "b.png",
                kind: "file",
                size: 18,
              },
            ],
          },
        ],
      },
    ] as any);

    expect(result.directories).toEqual(["screenshots", "screenshots/nested"]);
    expect(result.files).toEqual([
      {
        path: "/screenshots/a.png",
        relativePath: "screenshots/a.png",
      },
      {
        path: "/screenshots/nested/b.png",
        relativePath: "screenshots/nested/b.png",
      },
    ]);
  });
});

describe("destination helpers", () => {
  it("uses the provided folder destination as-is", () => {
    expect(resolveFolderDestination("/screenshots", "./downloads")).toBe("./downloads");
    expect(joinRelativeDestination("./downloads", "screenshots/a.png")).toBe("downloads/screenshots/a.png");
  });
});


it("rejects traversal and Windows paths from remote file listings", () => {
  for (const name of ["..", ".", "../outside", "a/b", "a\\b", "C:secret", ""]) {
    expect(() => flattenTree([{ id: "bad", path: "/bad", name, kind: "file", size: 0 }])).toThrow("Unsafe remote filename");
  }
  expect(() => joinRelativeDestination("downloads", "../outside")).toThrow();
  expect(() => getRemoteLeafName("/..")).toThrow();
});

it("rejects duplicate destinations before concurrent writes can race", () => {
  const file = { id: "one", path: "/a", name: "a", kind: "file" as const, size: 0 };
  expect(() => flattenTree([file, { ...file, id: "two" }])).toThrow("Duplicate remote destination");
});
