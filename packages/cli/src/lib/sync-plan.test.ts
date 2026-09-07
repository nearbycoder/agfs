import { expect, it } from "vitest";
import { syncOperation, ignoredPath } from "./sync-plan";
const base = { local: "local-v1", remote: "remote-v1" };
it("detects edits on both sides and never resolves conflicts by timestamps", () => {
  expect(syncOperation("local-v2", "remote-v2", base)).toBe("conflict");
  expect(syncOperation("local-v2", "remote-v1", base)).toBe("upload");
  expect(syncOperation("local-v1", "remote-v2", base)).toBe("download");
  expect(syncOperation("local-v1", "remote-v1", base)).toBe("unchanged");
  expect(syncOperation("local-v1", "remote-v1", undefined)).toBe("compare");
});
it("propagates only tracked, unambiguous, explicitly enabled deletions", () => {
  expect(syncOperation(undefined, "remote-v1", base)).toBe("unchanged");
  expect(syncOperation(undefined, "remote-v1", base, true)).toBe(
    "delete-remote",
  );
  expect(syncOperation("local-v1", undefined, base, true)).toBe("delete-local");
  expect(syncOperation(undefined, "remote-v2", base, true)).toBe("conflict");
  expect(syncOperation("local-v2", undefined, base, true)).toBe("conflict");
  expect(syncOperation(undefined, "remote-v1", undefined, true)).toBe(
    "download",
  );
});
it("ignores secrets, internal state, dependencies and explicit patterns on both sides", () => {
  for (const name of [
    ".env",
    "nested/.env.production",
    ".git/config",
    "node_modules/a",
    "nested/.agfs-sync.json",
    "build/a.txt",
    "nested/a.log",
    "reports/2026/a.csv",
  ])
    expect(ignoredPath(name, ["build/", "*.log", "reports/**/*.csv"])).toBe(
      true,
    );
  expect(ignoredPath("report.txt", ["*.log"])).toBe(false);
});
