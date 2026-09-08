import { describe, it, expect } from "vitest";
import { profileColumn } from "./csv-profile";
describe("CSV profiles", () => {
  it("distinguishes missing, blank, distinct and frequent values", () => {
    const p = profileColumn([["x"], [], [" "], ["x"], ["y"]], 0, 1);
    expect(p).toMatchObject({
      total: 5,
      missing: 1,
      blank: 1,
      distinct: 2,
      irregular: 1,
      common: [
        ["x", 2],
        ["y", 1],
      ],
    });
  });
  it("summarizes finite numbers without coercing hex or empty values", () => {
    expect(
      profileColumn([["1"], ["3"], ["0x10"], [""], ["1e999"]], 0, 1),
    ).toMatchObject({ numeric: 2, min: 1, max: 3, mean: 2 });
  });
  it("avoids displaying infinite averages and rejects invalid columns", () => {
    expect(profileColumn([["1e308"], ["1e308"]], 0, 1).mean).toBeNull();
    expect(() => profileColumn([], 1, 1)).toThrow();
  });
});
