import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const sessions = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

export const accounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    providerAccountIdx: uniqueIndex("account_provider_account_idx").on(table.providerId, table.accountId),
  }),
);

export const verifications = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(sql`(unixepoch() * 1000)`),
});

export const entries = sqliteTable(
  "entries",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentPath: text("parent_path"),
    path: text("path").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["file", "folder"] }).notNull(),
    size: integer("size"),
    contentType: text("content_type"),
    etag: text("etag"),
    r2Key: text("r2_key"),
    versionId: text("version_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    ownerPathUnique: uniqueIndex("entries_owner_path_idx").on(table.ownerId, table.path),
    parentPathIdx: index("entries_owner_parent_path_idx").on(table.ownerId, table.parentPath),
  }),
);

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  objectKey: text("object_key").notNull(),
  uploadTokenHash: text("upload_token_hash").notNull(),
  multipartId: text("multipart_id"),
  fingerprint: text("fingerprint"),
  status: text("status", { enum: ["pending", "completing", "committed", "expired"] })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  committedAt: integer("committed_at", { mode: "timestamp_ms" }),
});

export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pathPrefix: text("path_prefix").notNull().default("/"),
    permissions: text("permissions").notNull().default('["read","write","delete","share","manage"]'),
    label: text("label").notNull(),
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("api_tokens_hash_idx").on(table.tokenHash),
    ownerIdx: index("api_tokens_owner_idx").on(table.ownerId),
  }),
);

export const deviceCodes = sqliteTable("device_codes", {
  deviceCode: text("device_code").primaryKey(),
  userCode: text("user_code").notNull().unique(),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
  label: text("label"),
  apiTokenId: text("api_token_id").references(() => apiTokens.id, { onDelete: "set null" }),
  accessTokenPlaintext: text("access_token_plaintext"),
  intervalSeconds: integer("interval_seconds").notNull().default(5),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
  consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const shareLinks = sqliteTable("share_links", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  entryId: text("entry_id")
    .notNull()
    .references(() => entries.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

export const shareLinkViews = sqliteTable("share_link_views", {
  id: text("id").primaryKey(),
  shareId: text("share_id")
    .notNull()
    .references(() => shareLinks.id, { onDelete: "cascade" }),
  viewedAt: integer("viewed_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

export const entryAncestors = sqliteTable(
  "entry_ancestors",
  {
    ownerId: text("owner_id").notNull(),
    ancestorPath: text("ancestor_path").notNull(),
    descendantPath: text("descendant_path").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.ownerId, table.ancestorPath, table.descendantPath] }),
  }),
);

export const recovery = sqliteTable(
  "recovery",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: text("group_id").notNull(),
    reason: text("reason", { enum: ["trash", "version"] }).notNull(),
    path: text("path").notNull(),
    kind: text("kind", { enum: ["file", "folder"] }).notNull(),
    size: integer("size"),
    contentType: text("content_type"),
    etag: text("etag"),
    r2Key: text("r2_key"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    retainedAt: integer("retained_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    owner: index("recovery_owner_idx").on(t.ownerId, t.retainedAt),
    expiry: index("recovery_expiry_idx").on(t.expiresAt),
  }),
);

export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    path: text("path"),
    actor: text("actor").notNull(),
    tokenId: text("token_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({ owner: index("activity_owner_idx").on(t.ownerId, t.createdAt, t.id) }),
);

export const uploadParts = sqliteTable(
  "upload_parts",
  {
    uploadId: text("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    partNumber: integer("part_number").notNull(),
    digest: text("digest").notNull(),
    etag: text("etag").notNull(),
    size: integer("size").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.uploadId, t.partNumber] }) }),
);
