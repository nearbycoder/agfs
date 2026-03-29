import { describe, expect, it } from "vitest";
import { createContentDisposition, errorResponse, handleRouteError } from "./http";

describe("http helpers", () => {
  it("passes through Response instances", () => {
    const response = errorResponse(404, "missing");
    expect(handleRouteError(response)).toBe(response);
  });

  it("wraps ordinary errors", async () => {
    const response = handleRouteError(new Error("boom"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "boom" });
  });

  it("sanitizes content disposition filenames", () => {
    expect(createContentDisposition("attachment", 'te"st.png')).toContain('filename="te_st.png"');
    expect(createContentDisposition("inline", "snow man.png")).toContain("filename*=UTF-8''snow%20man.png");
  });
});
