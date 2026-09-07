import { describe, it, expect } from "vitest";
import { compareArtifacts, runSnapshot } from "./run-comparison";
describe("run comparisons", () => {
  it("matches output paths relative to different run folders", () =>
    expect(
      compareArtifacts(
        [{ path: "/v1/a", etag: "x", size: 1 }],
        [{ path: "/v2/a", etag: "y", size: 1 }],
        "/v1",
        "/v2",
      )[0].status,
    ).toBe("changed"));
  it("distinguishes added removed and unchanged inputs", () =>
    expect(
      compareArtifacts(
        [
          { path: "/a", etag: "x" },
          { path: "/b", etag: "b" },
        ],
        [
          { path: "/a", etag: "x" },
          { path: "/c", etag: "c" },
        ],
      ).map((r) => r.status),
    ).toEqual(["unchanged", "removed", "added"]));
  it("does not imply running runs have a saved output manifest", () =>
    expect(
      runSnapshot({
        id: "r",
        status: "running",
        path_prefix: "/r",
        metadata: "{}",
        inputs: "[]",
      }).hasOutputs,
    ).toBe(false));
});
