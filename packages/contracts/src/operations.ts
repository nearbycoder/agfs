import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]+$/).min(1).max(128);
const bytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
// SHA-256 scope (64), three separators, two safe-integer timestamps (16 each),
// and at most 4096 UTF-16 code units encoded as unpadded base64url. Path cursors
// store only the suffix relative to the requested scope, keeping generated POST
// bodies within the existing 16 KiB JSON envelope even at maximum UTF-8 paths.
export const OPERATIONS_CURSOR_MAX_LENGTH = 64 + 3 + 16 * 2 + 4 * Math.ceil(4096 * 2 / 3);
const cursor = z.string().max(OPERATIONS_CURSOR_MAX_LENGTH).optional();
const path = z.string().min(1).max(4096).startsWith("/");
const ids = (max: number) => z.array(id).min(1).max(max).refine((v) => new Set(v).size === v.length, "Duplicate IDs");

export const indexingPolicySchema = z.object({ mode: z.enum(["content", "metadata"]), maxTextBytes: bytes.max(1048576) }).strict();
export const backgroundPolicySchema = z.object({ indexingPaused: z.boolean(), webhooksPaused: z.boolean() }).strict();
export const indexDiagnosticsSchema = z.object({ path: path.default("/"), state: z.enum(["all", "pending", "failed", "current"]).default("all"), cursor });
export const reindexPlanSchema = z.object({ path, failedOnly: z.boolean().default(false), dryRun: z.boolean().default(true), cursor,
  reviewToken: z.string().min(1).max(512).optional() }).strict();
export const failureRetrySchema = z.object({ ids: ids(20) }).strict();
export const uploadInventorySchema = z.object({ path: path.default("/"), status: z.enum(["active", "pending", "completing", "expired", "committed"]).default("active"), tokenId: id.optional(), before: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), cursor });
export const abandonUploadsSchema = z.object({ ids: ids(20), dryRun: z.boolean().default(true) }).strict();
export const budgetHistorySchema = z.object({ tokenId: id, days: z.coerce.number().int().min(1).max(90).default(30) });
export const budgetTokensSchema = z.object({ cursor }).strict();
export const budgetPreflightSchema = z.object({ tokenId: id, operations: bytes.default(0), uploadBytes: bytes.default(0), storageBytes: bytes.default(0) }).strict();
export const budgetUpdateSchema = z.object({ id, paused: z.boolean(), storageLimit: bytes.nullable(), uploadLimit: bytes.nullable(), operationLimit: bytes.nullable() }).strict();
export const budgetBatchSchema = z.object({ updates: z.array(budgetUpdateSchema).min(1).max(20).refine((v) => new Set(v.map((r) => r.id)).size === v.length, "Duplicate IDs") }).strict();
export const operationMetricsSchema = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24), bucketMinutes: z.coerce.number().pipe(z.union([z.literal(5), z.literal(15), z.literal(60)])).default(60), route: z.enum(["api", "mcp", "search", "upload", "download"]).optional() }).refine((v) => v.hours * 60 / v.bucketMinutes <= 168, "Window exceeds 168 buckets; use larger buckets or fewer hours");
export const alertAcknowledgementSchema = z.object({ note: z.string().trim().max(500).default("") }).strict();
export const alertSnoozeSchema = z.object({ minutes: z.number().int().min(0).max(10080) }).strict();
export const retentionReferencesSchema = z.object({ path, cursor });
export const retentionExpirySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30), cursor });
export const webhookCleanupSchema = z.object({ ids: ids(50), dryRun: z.boolean().default(true) }).strict();
export const operationsPageSchema = z.object({ cursor });

export type IndexingPolicy = z.infer<typeof indexingPolicySchema>;
export type BackgroundPolicy = z.infer<typeof backgroundPolicySchema>;
export type OperationsPage<T> = { results: T[]; nextCursor: string | null };
export type OperationItemResult = { id: string; status: string };

export interface IndexingPolicyResult extends IndexingPolicy { revision: number; reindexRequired: boolean }
export interface BackgroundPolicyResult extends BackgroundPolicy { maintenanceContinues: true }
export interface IndexDiagnostic {
  id: string; path: string; kind: "file" | "folder"; size: number | null; contentType: string | null;
  queuedAt: number | null; attempts: number | null; lastError: string | null; nextAttempt: number | null;
  indexedAt: number | null; state: "pending" | "failed" | "current" | "missing";
  contentReason: "folder" | "metadata-policy" | "size-policy" | "unsupported-type" | "eligible";
}
export interface IndexDiagnosticsResult extends OperationsPage<IndexDiagnostic> { inspected: number }
export interface ReindexPlanResult extends OperationsPage<{ id: string; path: string; attempts: number }> {
  inspected: number; dryRun: boolean; enqueued: number; maximumR2Reads: number;
  reviewToken: string | null; reviewExpiresAt: number | null;
}
export interface QueueFailure { id: string; kind: "index" | "webhook"; path: string | null; createdAt: number; lastError: string }
export interface FailureRetryResult { results: Array<{ id: string; status: "retried" | "unavailable" }> }
export interface BacklogLowerBound { pendingAtLeast: number; hasMore: boolean; dueAtLeast: number; nextDueAt: number | null }
export interface MaintenanceStatusResult {
  generatedAt: number; progress: { lastDispatchAt: number | null; lastHealthAt: number | null; dispatched: number } | null;
  indexing: BacklogLowerBound; webhooks: BacklogLowerBound; health: { dueAt: number } | null;
  turnLimits: { backgroundCandidates: 50; healthOwners: 100 }; backlogIsLowerBound: true; continuation: string;
}
export interface UploadReservation {
  id: string; path: string; status: "pending" | "completing" | "expired" | "committed";
  size: number; createdAt: number; expiresAt: number; tokenId: string | null;
  multipart: boolean; uploadedBytes: number | null; reservedBytes: number;
}
export interface UploadInventoryResult extends OperationsPage<UploadReservation> { inspected: number }
export interface AbandonUploadsResult {
  results: Array<{ id: string; path?: string; status: "unavailable" | "already-abandoned" | "not-pending" | "would-abandon" | "abandoned" | "changed"; cleanupAfter?: number }>;
  dryRun: boolean; dailyUploadBudgetRefunded: false;
}
export interface BudgetHistoryResult {
  token: { id: string; label: string }; from: string; through: string; timezone: "UTC"; retentionDays: 90;
  results: Array<{ day: string; operations: number; uploadBytes: number }>;
}
export interface BudgetPreflightResult {
  advisory: true; allowedByAgentBudget: boolean; blockers: string[];
  remaining: { operations: number | null; uploadBytes: number | null; storageBytes: number | null };
  used: { operations: number; uploadBytes: number; storageBytes: number; reservedBytes: number };
  resetsAt: string; constraints: string;
}
export interface BudgetBatchResult { updated: string[] }
/** Non-revoked tokens, including paused/expired tokens, matching the legacy selector. */
export interface BudgetTokenSummary {
  id: string; label: string; pathPrefix: string; paused: boolean;
  storageLimit: number | null; uploadLimit: number | null; operationLimit: number | null;
}
export type BudgetTokensResult = OperationsPage<BudgetTokenSummary>;
export interface OperationMetricsResult {
  from: number; through: number; bucketMinutes: 5 | 15 | 60; retentionDays: 7;
  results: Array<{ at: number; requests: number; errors: number; rejections: number; averageMs: number | null }>;
}
/** Additional fields on existing /platform/health alert records. visible is SQLite 0/1. */
export interface AlertAttention {
  acknowledgedAt: number | null; acknowledgedBy: string | null; note: string | null;
  snoozedUntil: number | null; visible: 0 | 1;
}
export interface AlertAcknowledgementResult { ok: true; acknowledged: boolean }
export interface AlertSnoozeResult { ok: true; snoozedUntil: number | null; evaluationContinues: true }
export interface RetentionReference { kind: "live" | "trash" | "version" | "snapshot" | "run" | "pin"; referenceId: string; name: string; expiresAt: number | null }
export interface RetentionReferencesResult extends OperationsPage<RetentionReference> { path: string; etag: string | null; generatedAt: number }
export interface RetentionExpiryResult extends OperationsPage<{ referenceId: string; expiresAt: number; kind: "snapshot" | "run" | "pin"; name: string; bytes: number | null }> { from: number; through: number; semantics: string }
export interface WebhookCleanupResult {
  dryRun: boolean; eligible: Array<{ id: string; status: "delivered" | "failed" }>; payloadBytes: number; deleted: string[]; note: string;
}
