import { it, expect } from "vitest";
import { signTicket, verifyTicket } from "./ticket";
const secret = "test-only-signing-key-32-characters";
const ticket = { key: "u/alice/f/1/2", type: "text/plain", name: "file.txt", exp: Date.now() + 60_000 };
it("verifies signed short-lived preview tickets", async () => {
  expect(await verifyTicket(await signTicket(ticket, secret), secret)).toEqual(ticket);
});
it("rejects forged, expired, and active-content tickets", async () => {
  expect(await verifyTicket(await signTicket(ticket, secret), "wrong-key")).toBeNull();
  for (const value of [
    { ...ticket, exp: Date.now() - 1 },
    { ...ticket, exp: Date.now() + 600_000 },
    { ...ticket, type: "text/html" },
    { ...ticket, type: "image/svg+xml" },
  ])
    expect(await verifyTicket(await signTicket(value, secret), secret)).toBeNull();
  expect(await verifyTicket("broken.ticket", secret)).toBeNull();
});
