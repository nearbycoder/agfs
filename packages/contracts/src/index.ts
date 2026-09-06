import { z } from "zod";

export const ENTRY_KIND_VALUES = ["file", "folder"] as const;
export const TOKEN_SOURCE_VALUES = ["session", "api-token"] as const;
export const DEVICE_STATUS_VALUES = ["pending", "approved", "consumed", "expired"] as const;
export const STORAGE_PLAN_ID_VALUES = ["free", "paid"] as const;

export const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .startsWith("/");

export const ttlSchema = z
  .string()
  .regex(/^\d+\s*(m|h|d)$/i, "TTL must use m, h, or d units");

export const entryKindSchema = z.enum(ENTRY_KIND_VALUES);
export const tokenSourceSchema = z.enum(TOKEN_SOURCE_VALUES);
export const deviceStatusSchema = z.enum(DEVICE_STATUS_VALUES);
export const storagePlanIdSchema = z.enum(STORAGE_PLAN_ID_VALUES);

export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().email(),
  image: z.string().url().nullable().optional(),
});

export const fsEntrySchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  parentPath: z.string().nullable(),
  path: pathSchema,
  name: z.string(),
  kind: entryKindSchema,
  size: z.number().int().nonnegative().nullable(),
  contentType: z.string().nullable(),
  etag: z.string().nullable(),
  updatedAt: z.string(),
  createdAt: z.string(),
});

export const fsTreeNodeSchema: z.ZodType<{
  id: string;
  path: string;
  name: string;
  kind: (typeof ENTRY_KIND_VALUES)[number];
  size: number | null;
  children?: Array<unknown>;
}> = z.lazy(() =>
  z.object({
    id: z.string(),
    path: pathSchema,
    name: z.string(),
    kind: entryKindSchema,
    size: z.number().int().nonnegative().nullable(),
    children: z.array(fsTreeNodeSchema).optional(),
  }),
);

export const uploadIntentSchema = z.object({
  uploadId: z.string(),
  url: z.string().url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  objectKey: z.string(),
  expiresAt: z.string(),
});

export const apiTokenRecordSchema = z.object({
  id: z.string(),
  label: z.string(),
  prefix: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});

export const shareLinkRecordSchema = z.object({
  id: z.string(),
  path: pathSchema,
  url: z.string().url(),
  expiresAt: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});

export const whoAmIResponseSchema = z.object({
  user: sessionUserSchema,
  authSource: tokenSourceSchema,
});

export const accountSummarySchema = z.object({
  planId: storagePlanIdSchema,
  planName: z.string(),
  storageUsedBytes: z.number().int().nonnegative(),
  storageLimitBytes: z.number().int().nonnegative(),
  storageRemainingBytes: z.number().int().nonnegative(),
  isOverLimit: z.boolean(),
  paidPlanComingSoon: z.boolean(),
});

export const deviceStartRequestSchema = z.object({
  clientName: z.string().min(1).max(100).default("agfs cli"),
});

export const deviceStartResponseSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.string().url(),
  verificationUriComplete: z.string().url(),
  intervalSeconds: z.number().int().positive(),
  expiresAt: z.string(),
});

export const devicePollRequestSchema = z.object({
  deviceCode: z.string().min(1).max(128),
});

export const devicePollResponseSchema = z.union([
  z.object({
    status: z.literal("pending"),
    intervalSeconds: z.number().int().positive(),
    expiresAt: z.string(),
  }),
  z.object({
    status: z.literal("approved"),
    accessToken: z.string(),
    tokenType: z.literal("Bearer"),
    expiresAt: z.string().nullable(),
  }),
  z.object({
    status: z.literal("expired"),
  }),
]);

export const deviceApproveRequestSchema = z.object({
  userCode: z.string().trim().toUpperCase().regex(/^[0-9A-F]{8}$/),
  label: z.string().min(1).max(100).default("CLI login"),
});

export const listEntriesRequestSchema = z.object({
  path: pathSchema.default("/"),
});

export const listEntriesResponseSchema = z.object({
  path: pathSchema,
  entries: z.array(fsEntrySchema),
});

export const treeEntriesRequestSchema = z.object({
  path: pathSchema.default("/"),
});

export const treeEntriesResponseSchema = z.object({
  path: pathSchema,
  tree: z.array(fsTreeNodeSchema),
});

export const mkdirRequestSchema = z.object({
  path: pathSchema,
});

export const moveEntryRequestSchema = z.object({
  from: pathSchema,
  to: pathSchema,
});

export const deleteEntryRequestSchema = z.object({
  path: pathSchema,
  recursive: z.boolean().default(false),
});

export const uploadIntentRequestSchema = z.object({
  path: pathSchema,
  contentType: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(100_000_000, "Uploads are limited to 100 MB per file"),
});

export const uploadCommitRequestSchema = z.object({
  etag: z.string().min(1).max(256),
});

export const shareCreateRequestSchema = z.object({
  path: pathSchema,
  ttl: ttlSchema.default("15m"),
});

export const shareCreateResponseSchema = z.object({
  share: shareLinkRecordSchema,
});

export const shareListResponseSchema = z.object({
  shares: z.array(shareLinkRecordSchema),
});

export const tokenListResponseSchema = z.object({
  tokens: z.array(apiTokenRecordSchema),
});

export const tokenCreateRequestSchema = z.object({
  label: z.string().min(1).max(100),
  ttl: ttlSchema.optional(),
});

export const tokenCreateResponseSchema = z.object({
  token: z.string(),
  record: apiTokenRecordSchema,
});

export const successResponseSchema = z.object({
  ok: z.literal(true),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;
export type StoragePlanId = z.infer<typeof storagePlanIdSchema>;
export type AccountSummary = z.infer<typeof accountSummarySchema>;
export type FsEntry = z.infer<typeof fsEntrySchema>;
export type FsTreeNode = z.infer<typeof fsTreeNodeSchema>;
export type UploadIntent = z.infer<typeof uploadIntentSchema>;
export type ApiTokenRecord = z.infer<typeof apiTokenRecordSchema>;
export type ShareLinkRecord = z.infer<typeof shareLinkRecordSchema>;
