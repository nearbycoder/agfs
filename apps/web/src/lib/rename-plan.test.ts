import { describe, it, expect } from "vitest";
import { renamePlan } from "./rename-plan";
const entry = {
  id: "a",
  path: "/work/report.csv",
  name: "report.csv",
  etag: "etag",
};
const options = {
  prefix: "",
  suffix: "-final",
  find: "",
  replacement: "",
  preserveExtension: true,
};
describe("batch rename preview", () => {
  it("preserves extensions and source identity", () =>
    expect(renamePlan([entry], options)[0]).toEqual({
      from: entry.path,
      to: "/work/report-final.csv",
      entryId: "a",
      etag: "etag",
    }));
  it("uses literal replacements", () =>
    expect(
      renamePlan([{ ...entry, name: "a$b.txt", path: "/a$b.txt" }], {
        ...options,
        find: "$",
        replacement: "€",
      })[0].to,
    ).toBe("/a€b-final.txt"));
  it("rejects path injection and duplicate destinations", () => {
    expect(() => renamePlan([entry], { ...options, prefix: "../" })).toThrow();
    expect(() => renamePlan([entry, { ...entry, id: "b" }], options)).toThrow();
  });
  it("rejects unchanged and oversized batches", () => {
    expect(() => renamePlan([entry], { ...options, suffix: "" })).toThrow();
    expect(() => renamePlan(Array(51).fill(entry), options)).toThrow();
  });
});
