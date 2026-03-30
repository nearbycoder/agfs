import type { StoragePlanId } from "@agfs/contracts";
import { formatBytes } from "./format";

const GIB = 1024 ** 3;
const DEFAULT_STORAGE_PLAN_OVERRIDES_BY_EMAIL: Record<string, StoragePlanId> = {};

export interface StoragePlan {
  id: StoragePlanId;
  name: string;
  storageLimitBytes: number;
  priceMonthlyCents: number | null;
  comingSoon: boolean;
}

export const STORAGE_PLANS: Record<StoragePlanId, StoragePlan> = {
  free: {
    id: "free",
    name: "Free",
    storageLimitBytes: GIB,
    priceMonthlyCents: null,
    comingSoon: false,
  },
  paid: {
    id: "paid",
    name: "Paid",
    storageLimitBytes: 20 * GIB,
    priceMonthlyCents: 799,
    comingSoon: true,
  },
};

export const ORDERED_STORAGE_PLANS = [STORAGE_PLANS.free, STORAGE_PLANS.paid] as const;

export interface StorageWriteDecision {
  allowed: boolean;
  currentUsageBytes: number;
  projectedUsageBytes: number;
  storageLimitBytes: number;
  isOverLimit: boolean;
  message: string;
}

export function normalizePlanOverrideEmail(email: string) {
  return email.trim().toLowerCase();
}

export function parsePaidPlanEmails(value: string | null | undefined): Record<string, StoragePlanId> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_STORAGE_PLAN_OVERRIDES_BY_EMAIL;
  }

  return Object.fromEntries(
    value
      .split(",")
      .map(normalizePlanOverrideEmail)
      .filter((email) => email.length > 0)
      .map((email) => [email, "paid" satisfies StoragePlanId]),
  );
}

export function resolveStoragePlanIdForEmail(
  email: string,
  overrides: Record<string, StoragePlanId> = DEFAULT_STORAGE_PLAN_OVERRIDES_BY_EMAIL,
): StoragePlanId {
  return overrides[normalizePlanOverrideEmail(email)] ?? "free";
}

export function resolveStoragePlanForEmail(
  email: string,
  overrides: Record<string, StoragePlanId> = DEFAULT_STORAGE_PLAN_OVERRIDES_BY_EMAIL,
) {
  return STORAGE_PLANS[resolveStoragePlanIdForEmail(email, overrides)];
}

export function evaluateStorageWrite(input: {
  plan: StoragePlan;
  usedBytes: number;
  existingFileSizeBytes?: number | null;
  incomingSizeBytes: number;
}): StorageWriteDecision {
  const currentUsageBytes = Math.max(input.usedBytes, 0);
  const existingFileSizeBytes = Math.max(input.existingFileSizeBytes ?? 0, 0);
  const incomingSizeBytes = Math.max(input.incomingSizeBytes, 0);
  const projectedUsageBytes = Math.max(currentUsageBytes - existingFileSizeBytes, 0) + incomingSizeBytes;
  const storageLimitBytes = input.plan.storageLimitBytes;
  const isOverLimit = currentUsageBytes > storageLimitBytes;
  const allowed = isOverLimit ? projectedUsageBytes <= currentUsageBytes : projectedUsageBytes <= storageLimitBytes;
  const message = allowed
    ? ""
    : `Storage limit reached for the ${input.plan.name} plan (${formatBytes(storageLimitBytes)}). Current usage is ${formatBytes(currentUsageBytes)} and this upload would use ${formatBytes(projectedUsageBytes)}.`;

  return {
    allowed,
    currentUsageBytes,
    projectedUsageBytes,
    storageLimitBytes,
    isOverLimit,
    message,
  };
}
