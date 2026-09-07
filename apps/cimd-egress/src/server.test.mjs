import { test } from "node:test";
import assert from "node:assert/strict";
process.env.AGFS_CIMD_TEST = "1";
const { metadata } = await import("./server.mjs");
test("rejects plaintext, credentials, custom ports and fragments", async () => {
  for (const url of [
    "http://example.com",
    "https://a:b@example.com",
    "https://example.com:8443/",
    "https://example.com/#fragment",
  ])
    await assert.rejects(metadata(url));
});
test("rejects loopback and link-local destinations", async () => {
  for (const url of [
    "https://127.0.0.1/",
    "https://169.254.169.254/",
    "https://10.0.0.1/",
  ])
    await assert.rejects(metadata(url));
});
