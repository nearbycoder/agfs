import { describe, expect, it } from "vitest";
import {
  decodeRunSelection,
  filterRuns,
  parseRunMetadata,
  replayRun,
  runInputSelection,
  runReport,
  normalizeRunSelection,
} from "./run-workflows";
describe("run workflow shortcuts", () => {
  it("roundtrips selected paths without interpreting query metacharacters", () => {
    const paths = ["/inputs/a & b.json", "/inputs/a#b.md", "/inputs/é.txt"];
    const params = new URLSearchParams({ inputs: runInputSelection(paths) });
    expect(
      decodeRunSelection(new URLSearchParams(params.toString()).get("inputs")!),
    ).toEqual(paths);
    expect(decodeRunSelection(normalizeRunSelection(paths))).toEqual(paths);
  });
  it("refuses duplicates, relative paths, oversized shortcuts, and selections over 50", () => {
    expect(() => runInputSelection(["/x", "/x"])).toThrow("distinct");
    expect(() => runInputSelection(["relative"])).toThrow("paths");
    expect(() =>
      runInputSelection(Array.from({ length: 51 }, (_, i) => "/" + i)),
    ).toThrow("1–50");
    expect(() =>
      runInputSelection(
        Array.from({ length: 10 }, (_, i) => "/" + i + "x".repeat(2000)),
      ),
    ).toThrow("too long");
    expect(() => decodeRunSelection('{"bad":true}')).toThrow();
  });
  it("validates metadata labels without permitting arbitrary nested values", () => {
    expect(parseRunMetadata('{"model":"v1"}')).toEqual({ model: "v1" });
    expect(() => parseRunMetadata('{"model":3}')).toThrow();
    expect(() =>
      parseRunMetadata(
        JSON.stringify(
          Object.fromEntries(
            Array.from({ length: 31 }, (_, i) => ["k" + i, "v"]),
          ),
        ),
      ),
    ).toThrow("30");
  });
  it("filters loaded runs by status and metadata", () => {
    const runs = [
      {
        id: "r1",
        name: "One",
        path_prefix: "/a",
        status: "running",
        created_at: 1,
        metadata: '{"model":"beta"}',
      },
      {
        id: "r2",
        name: "Two",
        path_prefix: "/b",
        status: "completed",
        created_at: 2,
        metadata: "{}",
      },
    ];
    expect(filterRuns(runs, "BETA", "running")).toEqual([runs[0]]);
    expect(filterRuns(runs, "BETA", "completed")).toEqual([]);
  });
  it("prepares rerun with live paths and a separate output folder", () => {
    const replay = replayRun(
      {
        id: "run_1",
        name: "Review",
        metadata: '{"model":"v1"}',
        inputs: '[{"path":"/input.md","etag":"old","r2_key":"private"}]',
      },
      123,
    );
    expect(replay.inputs).toBe("/input.md");
    expect(replay.path).toBe("/runs/run_1-123");
    expect(replay.metadata).not.toContain("r2_key");
  });
  it("exports escaped Markdown metadata and checksums", () => {
    const report = runReport({
      runId: "r1",
      name: "<script>",
      completedAt: "now",
      retainedUntil: "later",
      metadata: { task: "a|b" },
      inputs: [],
      artifacts: [{ path: "/a|b.md", size: 2, etag: "v1", checksum: "abc" }],
    });
    expect(report).toContain("\\<script\\>");
    expect(report).toContain("a\\|b");
    expect(report).toContain("abc");
    expect(report).not.toContain("r2_key");
  });
});
