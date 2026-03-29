import { and, eq, sql } from "drizzle-orm";
import type { AccountSummary, SessionUser } from "@agfs/contracts";
import { entries } from "@agfs/db";
import { db } from "./db";
import { STORAGE_PLANS, evaluateStorageWrite, resolveStoragePlanForEmail } from "./storage-plans";

export type AccountUser = Pick<SessionUser, "id" | "email">;

export async function getCommittedStorageBytes(ownerId: string) {
  const [row] = await db
    .select({
      storageUsedBytes: sql<number>`coalesce(sum(${entries.size}), 0)`,
    })
    .from(entries)
    .where(and(eq(entries.ownerId, ownerId), eq(entries.kind, "file")));

  return Number(row?.storageUsedBytes ?? 0);
}

export async function getAccountSummaryForUser(user: AccountUser): Promise<AccountSummary> {
  const plan = resolveStoragePlanForEmail(user.email);
  const storageUsedBytes = await getCommittedStorageBytes(user.id);

  return {
    planId: plan.id,
    planName: plan.name,
    storageUsedBytes,
    storageLimitBytes: plan.storageLimitBytes,
    storageRemainingBytes: Math.max(plan.storageLimitBytes - storageUsedBytes, 0),
    isOverLimit: storageUsedBytes > plan.storageLimitBytes,
    paidPlanComingSoon: STORAGE_PLANS.paid.comingSoon,
  };
}

export async function getStorageWriteDecisionForUser(input: {
  user: AccountUser;
  existingFileSizeBytes?: number | null;
  incomingSizeBytes: number;
}) {
  const plan = resolveStoragePlanForEmail(input.user.email);
  const usedBytes = await getCommittedStorageBytes(input.user.id);

  return evaluateStorageWrite({
    plan,
    usedBytes,
    existingFileSizeBytes: input.existingFileSizeBytes,
    incomingSizeBytes: input.incomingSizeBytes,
  });
}
