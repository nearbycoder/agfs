import { expect, it } from "vitest";
import { openDeviceToken, sealDeviceToken } from "./device-token";
it("encrypts temporary device tokens and rejects tampering or another key", () => {
  const sealed = sealDeviceToken("agfs_sensitive-token", "test-secret");
  expect(sealed).not.toContain("sensitive-token");
  expect(openDeviceToken(sealed, "test-secret")).toBe("agfs_sensitive-token");
  expect(() => openDeviceToken(sealed, "wrong-secret")).toThrow();
  const bytes = Buffer.from(sealed.slice(3), "base64url"); bytes[30] ^= 1;
  expect(() => openDeviceToken(`v1.${bytes.toString("base64url")}`, "test-secret")).toThrow();
});
