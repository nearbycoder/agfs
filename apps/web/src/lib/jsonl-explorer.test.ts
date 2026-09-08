import { describe, it, expect } from "vitest";
import { jsonlRecords, filterJsonl } from "./jsonl-explorer";
describe("JSONL explorer", () => {
  it("isolates malformed lines and preserves original numbers", () => {
    const rows = jsonlRecords(
      '\n{"level":"ERROR","id":9007199254740993}\n{bad}\nnull',
    );
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4]);
    expect(rows[0].raw).toContain("9007199254740993");
    expect(rows[1].error).toBeTruthy();
    expect(rows[2].error).toBe("");
  });
  it("filters level and text together", () => {
    const rows = jsonlRecords(
      '{"severity":"WARN","message":"Disk"}\n{"level":"info","message":"disk"}',
    );
    expect(filterJsonl(rows, "DISK", "warn")).toHaveLength(1);
  });
  it("bounds line count and supports empty files", () => {
    expect(jsonlRecords("\n")).toEqual([]);
    expect(() => jsonlRecords("\n".repeat(5001))).toThrow();
  });
});
