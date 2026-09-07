import { describe, it, expect } from "vitest";
import { filterActivity, csvCell, activityCsv } from "./activity-explorer";
const event = {
  id: "a",
  action: "download",
  path: "/Reports/a.txt",
  actor: "Alice",
  tokenId: null,
  createdAt: "2026-09-07T12:00:00Z",
};
describe("activity exploration", () => {
  it("combines action path actor and date bounds", () => {
    const f = {
      action: "download",
      path: "reports",
      actor: "ali",
      from: "2026-09-06",
      to: "2026-09-08",
    };
    expect(filterActivity([event], f)).toHaveLength(1);
    expect(filterActivity([event], { ...f, action: "upload" })).toHaveLength(0);
  });
  it("neutralizes spreadsheet formulas and quotes multiline data", () => {
    for (const value of ["=1+1", " +cmd", "-2", "@SUM(A1)", "\ttext"])
      expect(csvCell(value).startsWith("\"'")).toBe(true);
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it("exports only supplied matching records", () => {
    expect(activityCsv([]).split("\r\n")).toHaveLength(2);
    expect(activityCsv([event])).toContain("/Reports/a.txt");
  });
});
