import { storageUsageSql } from "./storage-usage";
import { and, eq, sql } from "drizzle-orm";
import type { AccountSummary, SessionUser } from "@agfs/contracts";
import { entries } from "@agfs/db";
import { getBindings } from "./bindings";
import { db } from "./db";
import {
  STORAGE_PLANS,
  evaluateStorageWrite,
  parsePaidPlanEmails,
  resolveStoragePlanForEmail,
} from "./storage-plans";

export type AccountUser = Pick<SessionUser, "id" | "email">;

async function storagePlan(user: AccountUser) {
  const plan = resolveStoragePlanForEmail(
    user.email,
    getStoragePlanOverridesByEmail(),
  );
  if (!user.id.startsWith("ws_")) return plan;
  const { first } = await import("./platform-db");
  const workspace = await first(
    sql`SELECT storage_limit FROM workspaces WHERE id=${user.id}`,
  );
  return {
    ...plan,
    storageLimitBytes: Math.min(
      plan.storageLimitBytes,
      workspace?.storage_limit ?? 0,
    ),
  };
}
function getStoragePlanOverridesByEmail() {
  return parsePaidPlanEmails(getBindings().PAID_PLAN_EMAILS);
}

export async function getCommittedStorageBytes(ownerId: string) {
  const result = await db.run(sql`SELECT ${storageUsageSql(ownerId)} AS bytes`);
  return Number(result.results[0]?.bytes ?? 0);
}

export async function getAccountSummaryForUser(
  user: AccountUser,
): Promise<AccountSummary> {
  const plan = await storagePlan(user);
  const storageUsedBytes = await getCommittedStorageBytes(user.id);

  return {
    planId: plan.id,
    planName: plan.name,
    storageUsedBytes,
    storageLimitBytes: plan.storageLimitBytes,
    storageRemainingBytes: Math.max(
      plan.storageLimitBytes - storageUsedBytes,
      0,
    ),
    isOverLimit: storageUsedBytes > plan.storageLimitBytes,
    paidPlanComingSoon: STORAGE_PLANS.paid.comingSoon,
  };
}

export async function getStorageWriteDecisionForUser(input: {
  user: AccountUser;
  existingFileSizeBytes?: number | null;
  incomingSizeBytes: number;
}) {
  const plan = await storagePlan(input.user);
  const usedBytes = await getCommittedStorageBytes(input.user.id);

  return evaluateStorageWrite({
    plan,
    usedBytes,
    existingFileSizeBytes: 0, // Overwrites retain the previous object.
    incomingSizeBytes: input.incomingSizeBytes,
  });
}
