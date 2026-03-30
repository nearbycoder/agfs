import { describe, expect, it } from "vitest";
import { STORAGE_PLANS, evaluateStorageWrite, parsePaidPlanEmails, resolveStoragePlanIdForEmail } from "./storage-plans";

describe("storage plan resolution", () => {
  it("defaults users to the free plan", () => {
    expect(resolveStoragePlanIdForEmail("person@example.com")).toBe("free");
  });

  it("resolves overrides by normalized email", () => {
    expect(resolveStoragePlanIdForEmail("VIP@Example.com", { "vip@example.com": "paid" })).toBe("paid");
  });

  it("parses paid plan emails from a comma-delimited env value", () => {
    expect(parsePaidPlanEmails(" VIP@Example.com, second@example.com ,,")).toEqual({
      "second@example.com": "paid",
      "vip@example.com": "paid",
    });
  });
});

describe("storage quota policy", () => {
  const freePlan = STORAGE_PLANS.free;

  it("allows a new upload when it stays under the limit", () => {
    const decision = evaluateStorageWrite({
      plan: freePlan,
      usedBytes: freePlan.storageLimitBytes - 200,
      incomingSizeBytes: 100,
    });

    expect(decision.allowed).toBe(true);
  });

  it("rejects a new upload when it would exceed the limit", () => {
    const decision = evaluateStorageWrite({
      plan: freePlan,
      usedBytes: freePlan.storageLimitBytes - 50,
      incomingSizeBytes: 100,
    });

    expect(decision.allowed).toBe(false);
  });

  it("uses the size delta for overwrites instead of counting the whole file again", () => {
    const decision = evaluateStorageWrite({
      plan: freePlan,
      usedBytes: freePlan.storageLimitBytes - 100,
      existingFileSizeBytes: 400,
      incomingSizeBytes: 450,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.projectedUsageBytes).toBe(freePlan.storageLimitBytes - 50);
  });

  it("allows a smaller replacement while already over limit", () => {
    const decision = evaluateStorageWrite({
      plan: freePlan,
      usedBytes: freePlan.storageLimitBytes + 100,
      existingFileSizeBytes: 400,
      incomingSizeBytes: 200,
    });

    expect(decision.allowed).toBe(true);
  });

  it("allows a same-size replacement while already over limit", () => {
    const decision = evaluateStorageWrite({
      plan: freePlan,
      usedBytes: freePlan.storageLimitBytes + 100,
      existingFileSizeBytes: 400,
      incomingSizeBytes: 400,
    });

    expect(decision.allowed).toBe(true);
  });

  it("rejects a larger replacement while already over limit", () => {
    const decision = evaluateStorageWrite({
      plan: freePlan,
      usedBytes: freePlan.storageLimitBytes + 100,
      existingFileSizeBytes: 400,
      incomingSizeBytes: 500,
    });

    expect(decision.allowed).toBe(false);
  });
});
