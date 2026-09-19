import { describe, expect, it } from "vitest";
import {
  createContentDisposition,
  errorResponse,
  handleRouteError,
} from "./http";

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
    expect(createContentDisposition("attachment", 'te"st.png')).toContain(
      'filename="te_st.png"',
    );
    expect(createContentDisposition("inline", "snow man.png")).toContain(
      "filename*=UTF-8''snow%20man.png",
    );
  });
});

import { z } from "zod";
import { parseJson, requireSameOriginMutation } from "./http";

it("blocks cross-origin mutations, including sibling domains", () => {
  for (const origin of ["https://evil.test", "https://sub.agfs.dev", "null"]) {
    expect(() =>
      requireSameOriginMutation(
        new Request("https://agfs.dev/api/v1/tokens", {
          method: "DELETE",
          headers: { origin },
        }),
        "https://agfs.dev",
      ),
    ).toThrow(Response);
  }
  expect(() =>
    requireSameOriginMutation(
      new Request("https://agfs.dev/api/v1/tokens", {
        method: "DELETE",
        headers: { origin: "https://agfs.dev" },
      }),
      "https://agfs.dev",
    ),
  ).not.toThrow();
  expect(() =>
    requireSameOriginMutation(
      new Request("https://agfs.dev/api/v1/tokens", { method: "DELETE" }),
      "https://agfs.dev",
    ),
  ).not.toThrow();
});

it("requires JSON and bounds streamed bodies", async () => {
  await expect(
    parseJson(
      new Request("https://agfs.dev", { method: "POST", body: "{}" }),
      z.object({}),
    ),
  ).rejects.toMatchObject({ status: 415 });
  await expect(
    parseJson(
      new Request("https://agfs.dev", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "a".repeat(20_000) }),
      }),
      z.object({}),
    ),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    parseJson(
      new Request("https://agfs.dev", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      z.object({}),
    ),
  ).resolves.toEqual({});
});

import { isJsonRequest, securityPathname } from "./http";
it("uses case-insensitive JSON media types consistently at the server boundary", () => {
  expect(
    isJsonRequest(
      new Request("https://agfs.dev", {
        headers: { "content-type": "Application/JSON; charset=utf-8" },
      }),
    ),
  ).toBe(true);
  expect(
    isJsonRequest(
      new Request("https://agfs.dev", {
        headers: { "content-type": "text/plain" },
      }),
    ),
  ).toBe(false);
});
it("rejects malformed encoded paths as a controlled client error", () => {
  for (const path of ["/%", "/api/v1/%FF", "/%E0%A4"]) {
    expect(() =>
      securityPathname(new Request("https://agfs.dev" + path)),
    ).toThrow(Response);
    try {
      securityPathname(new Request("https://agfs.dev" + path));
    } catch (error) {
      expect(error).toMatchObject({ status: 400 });
    }
  }
  expect(
    securityPathname(new Request("https://agfs.dev/%61pi/V1/tokens")),
  ).toBe("/api/v1/tokens");
});

it.each([3, 100])(
  "rejects oversized streams with bounded draining (%i chunks)",
  async (count) => {
    let emitted = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          emitted++;
          controller.enqueue(new Uint8Array(8192));
          if (emitted === count) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request("https://agfs.dev", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    await expect(parseJson(request, z.unknown())).rejects.toMatchObject({
      status: 413,
    });
    expect(emitted).toBe(count === 3 ? 3 : 9);
    expect(cancelled).toBe(count !== 3);
  },
);
