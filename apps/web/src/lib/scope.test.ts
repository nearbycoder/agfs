import { describe, it, expect } from "vitest";
import { authorize, canAccess, withinPath } from "./scope";
import type { RequestAuth } from "./authz";
const auth: RequestAuth = {
  authSource: "api-token",
  pathPrefix: "/project",
  permissions: ["read"],
  user: { id: "a", email: "a@example.com", name: "A" },
};
describe("scoped credentials", () => {
  it("allows only the folder boundary and descendants", () => {
    expect(canAccess(auth, "read", "/project")).toBe(true);
    expect(canAccess(auth, "read", "/project/a")).toBe(true);
    for (const path of ["/", "/projects/a", "/Project/a"]) expect(canAccess(auth, "read", path)).toBe(false);
  });
  it("denies writes, sharing, and credential escalation", () => {
    for (const permission of ["write", "delete", "share", "manage"] as const)
      expect(() => authorize(auth, permission, "/project")).toThrow();
  });
  it("normalizes paths before checking scope and rejects traversal", () => {
    expect(withinPath("//project//a", "/project/")).toBe(true);
    expect(() => withinPath("/project/../secret", "/project")).toThrow();
  });
  it("checks both sides of moves", () => {
    expect(() => authorize({ ...auth, permissions: ["write"] }, "write", "/project/a", "/outside")).toThrow();
  });
  it("treats wildcard characters and Unicode literally", () => {
    expect(withinPath("/a_b/file", "/a_b")).toBe(true);
    expect(withinPath("/axb/file", "/a_b")).toBe(false);
    expect(withinPath("/😀/file", "/😀")).toBe(true);
  });
});
