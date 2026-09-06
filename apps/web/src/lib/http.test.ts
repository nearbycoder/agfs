import { describe, expect, it } from "vitest";
import { createContentDisposition, errorResponse, handleRouteError } from "./http";

describe("http helpers", () => {
  it("passes through Response instances", () => {
    const response = errorResponse(404, "missing");
    expect(handleRouteError(response)).toBe(response);
  });

  it("wraps ordinary errors", async () => {
    const response = handleRouteError(new Error("boom"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Request failed" });
  });

  it("sanitizes content disposition filenames", () => {
    expect(createContentDisposition("attachment", 'te"st.png')).toContain('filename="te_st.png"');
    expect(createContentDisposition("inline", "snow man.png")).toContain("filename*=UTF-8''snow%20man.png");
  });
});

import { z } from "zod";
import { parseJson, requireSameOriginMutation } from "./http";

it("blocks cross-origin mutations, including sibling domains", () => {
  for (const origin of ["https://evil.test", "https://sub.agfs.dev", "null"]) {
    expect(() => requireSameOriginMutation(new Request("https://agfs.dev/api/v1/tokens", { method: "DELETE", headers: { origin } }), "https://agfs.dev")).toThrow(Response);
  }
  expect(() => requireSameOriginMutation(new Request("https://agfs.dev/api/v1/tokens", { method: "DELETE", headers: { origin: "https://agfs.dev" } }), "https://agfs.dev")).not.toThrow();
  expect(() => requireSameOriginMutation(new Request("https://agfs.dev/api/v1/tokens", { method: "DELETE" }), "https://agfs.dev")).not.toThrow();
});

it("requires JSON and bounds streamed bodies", async () => {
  await expect(parseJson(new Request("https://agfs.dev", { method: "POST", body: '{}' }), z.object({}))).rejects.toMatchObject({ status: 415 });
  await expect(parseJson(new Request("https://agfs.dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "a".repeat(20_000) }) }), z.object({}))).rejects.toMatchObject({ status: 413 });
  await expect(parseJson(new Request("https://agfs.dev", { method: "POST", headers: { "content-type": "application/json" }, body: '{}' }), z.object({}))).resolves.toEqual({});
});
