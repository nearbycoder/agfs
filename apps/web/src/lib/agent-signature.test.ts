import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAgentWebhook } from "./agent-signature";
describe("local webhook verification", () => {
  const secret = "test-only-secret",
    body = '{"id":1}',
    timestamp = "1800000000";
  const signed =
    "v1=" +
    createHmac("sha256", secret)
      .update(timestamp + "." + body)
      .digest("hex");
  it("verifies exact bytes with constant-time Web Crypto and freshness", async () => {
    expect(
      (await verifyAgentWebhook(body, secret, timestamp, signed, 1800000100000))
        .accepted,
    ).toBe(true);
    expect(
      (
        await verifyAgentWebhook(
          body + " ",
          secret,
          timestamp,
          signed,
          1800000100000,
        )
      ).signatureValid,
    ).toBe(false);
    expect(
      (
        await verifyAgentWebhook(
          body,
          "wrong",
          timestamp,
          signed,
          1800000100000,
        )
      ).accepted,
    ).toBe(false);
  });
  it("accepts either rotation signature but rejects stale and future requests", async () => {
    expect(
      (
        await verifyAgentWebhook(
          body,
          secret,
          timestamp,
          "v1=" + "0".repeat(64) + "," + signed,
          1800000100000,
        )
      ).accepted,
    ).toBe(true);
    expect(
      (await verifyAgentWebhook(body, secret, timestamp, signed, 1800000301000))
        .accepted,
    ).toBe(false);
    expect(
      (await verifyAgentWebhook(body, secret, timestamp, signed, 1799999999000))
        .accepted,
    ).toBe(false);
  });
  it("rejects malformed headers", async () => {
    await expect(
      verifyAgentWebhook(body, secret, "bad", signed),
    ).rejects.toThrow("Unix seconds");
    await expect(
      verifyAgentWebhook(body, secret, timestamp, "v1=xyz"),
    ).rejects.toThrow("64 hex");
  });
});
