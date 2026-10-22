import { sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { atomicBatch } from "./atomic-batch";
import { requireResourceBindings } from "./bindings";

const DAY = 86_400_000;
export const CLEANUP_PAGE = 25;
type Row = Record<string, string | number | null> & { rid: string; expiry: string | number };
type Task = { name: string; table: string; column: string; index: string; keys: string[]; age?: number; predicate?: string; limit?: number; child?: [string, string, string]; intent?: string };
// Each expiry index has rowid as its immediate tie-breaker. Do not substitute
// an index with an intervening owner/key column: late equal-expiry pages scan it.
const TASKS: Task[] = [
  { name: "uploads", table: "uploads", column: "expires_at", index: "cleanup_upload_expiry", keys: ["id", "object_key", "multipart_id"], predicate: "status IN ('pending','completing','expired')", limit: 5, child: ["upload_parts", "upload_id", "id"], intent: "object_key" },
  { name: "recovery", table: "recovery", column: "expires_at", index: "recovery_expiry_idx", keys: ["id"], intent: "r2_key" },
  { name: "pins", table: "object_pins", column: "expires_at", index: "object_pins_expiry_idx", keys: ["reference_id", "object_key"], intent: "object_key" },
  { name: "snapshots", table: "snapshots", column: "expires_at", index: "cleanup_snapshot_expiry", keys: ["id"], limit: 1, child: ["snapshot_entries", "snapshot_id", "id"] },
  { name: "aliases", table: "token_rotation_aliases", column: "expires_at", index: "cleanup_alias_expiry", keys: ["token_hash"] },
  { name: "secrets", table: "webhooks", column: "previous_secret_until", index: "cleanup_secret_expiry", keys: ["id"] },
  { name: "idempotency", table: "idempotency", column: "created_at", index: "idempotency_expiry", keys: ["owner_id", "key_hash"], age: DAY },
  // seq is the INTEGER PRIMARY KEY alias for rowid, already transported exactly
  // as decimal text. Do not round it through a second numeric JSON field.
  { name: "changes", table: "change_log", column: "created_at", index: "cleanup_change_expiry", keys: [], age: 30 * DAY },
  { name: "metrics", table: "operation_metrics", column: "minute", index: "operation_metrics_minute_idx", keys: ["owner_id", "minute", "route"] },
  { name: "transfers", table: "ownership_transfers", column: "expires_at", index: "cleanup_transfer_expiry", keys: ["workspace_id"] },
  { name: "outbox", table: "queue_outbox", column: "created_at", index: "queue_outbox_created_idx", keys: ["id"], age: 7 * DAY },
  { name: "alerts", table: "health_alerts", column: "resolved_at", index: "cleanup_alert_expiry", keys: ["id"], age: 30 * DAY },
  { name: "deliveries", table: "webhook_deliveries", column: "created_at", index: "webhook_deliveries_created_idx", keys: ["id"], age: 30 * DAY },
  { name: "invites", table: "workspace_invites", column: "expires_at", index: "cleanup_invite_expiry", keys: ["id"] },
  { name: "usage", table: "agent_usage", column: "day", index: "cleanup_usage_expiry", keys: ["token_id", "day"] },
  { name: "devices", table: "device_codes", column: "expires_at", index: "cleanup_device_expiry", keys: ["device_code"] },
  { name: "activity", table: "activity", column: "created_at", index: "activity_created_idx", keys: ["id"], age: 90 * DAY },
  { name: "shares", table: "share_links", column: "expires_at", index: "cleanup_share_expiry", keys: ["id"], age: 30 * DAY, limit: 1, child: ["share_link_views", "share_id", "id"] },
  { name: "committed", table: "uploads", column: "committed_at", index: "cleanup_upload_committed", keys: ["id"], age: 7 * DAY, predicate: "status='committed'", limit: 5, child: ["upload_parts", "upload_id", "id"] },
];
type State = { task: string; cutoff: string | number; cursor_expiry: string | number; cursor_rowid: string; revision: string };
function cutoff(task: Task, at: number) {
  if (task.name === "metrics") return Math.floor(at / 60000) - 7 * 1440;
  if (task.name === "usage") return new Date(at - 90 * DAY).toISOString().slice(0, 10);
  return at - (task.age ?? 0);
}
function predicate(task: Task) { return sql.raw(task.predicate ?? "1"); }

async function page(task: Task, before: string | number, cursor?: State) {
  const table = sql.raw(task.table), column = sql.raw(task.column), index = sql.raw(task.index), limit = task.limit ?? CLEANUP_PAGE;
  const fields = sql.raw(["CAST(rowid AS TEXT) AS rid", `${task.column} AS expiry`, ...task.keys].join(","));
  const query = cursor
    ? sql`WITH equal_expiry AS (SELECT ${fields} FROM ${table} INDEXED BY ${index}
        WHERE ${predicate(task)} AND ${column}=${cursor.cursor_expiry} AND rowid>CAST(${cursor.cursor_rowid} AS INTEGER) AND ${column}<${before}
        ORDER BY rowid LIMIT ${limit}), later_expiry AS (SELECT ${fields} FROM ${table} INDEXED BY ${index}
        WHERE ${predicate(task)} AND ${column}>${cursor.cursor_expiry} AND ${column}<${before}
        ORDER BY ${column},rowid LIMIT ${limit})
      SELECT * FROM (SELECT * FROM equal_expiry UNION ALL SELECT * FROM later_expiry)
      ORDER BY expiry,CAST(rid AS INTEGER) LIMIT ${limit}`
    : sql`SELECT ${fields} FROM ${table} INDEXED BY ${index}
        WHERE ${predicate(task)} AND ${column}<${before} ORDER BY ${column},rowid LIMIT ${limit}`;
  return (await db.run(query)).results as Row[];
}

// The same live identity/expiry predicate is used by intent enqueue and source
// retirement inside one transaction. A renewed pin/reservation is not retired.
function selected(task: Task, rows: Row[], before: string | number) {
  const encoded = JSON.stringify(rows);
  // Force the original unique id index at every upload parent alias below.
  // Even rowid equality can lose to a population range under one-row ANALYZE
  // statistics. Direct unique-id equality bounds access; rowid remains a guard.
  if (task.table === "uploads" && rows.length !== 1) throw new Error("Upload cleanup requires one selected identity");
  const identity = task.table === "uploads" ? sql`t.id=${rows[0].id} AND t.rowid=CAST(${rows[0].rid} AS INTEGER)`
    : sql`t.rowid IN (SELECT CAST(json_extract(value,'$.rid') AS INTEGER) FROM json_each(${encoded}))`;
  return sql`${identity}
    AND ${sql.raw(`t.${task.column}`)}<${before} AND ${predicate(task)}
    AND EXISTS(SELECT 1 FROM json_each(${encoded}) j WHERE t.rowid=CAST(json_extract(j.value,'$.rid') AS INTEGER)
      AND ${sql.raw(`t.${task.column}`)} IS json_extract(j.value,'$.expiry')
      ${sql.join(task.keys.map((key) => sql`AND ${sql.raw(`t.${key}`)} IS json_extract(j.value,${`$.${key}`})`), sql` `)})`;
}

async function mutations(task: Task, rows: Row[], before: string | number, at: number) {
  const queries: SQL[] = [], table = sql.raw(task.table);
  const parentIndex = sql.raw(task.table === "uploads" ? " INDEXED BY sqlite_autoindex_uploads_1" : "");
  let eligible = rows;
  if (task.name === "uploads") {
    const expired = selected(task, rows, before);
    // Keeping a large part collection for later pages must not keep its expired
    // reservation charged as active. Retain the row for abort retries, but
    // atomically expire it and renew immutable-key GC intent even if abort fails.
    // A commit/renewal during abort fails this same live predicate.
    queries.push(sql`UPDATE uploads AS t${parentIndex} SET status='expired' WHERE ${expired} AND status<>'expired'`);
    queries.push(sql`INSERT INTO object_gc(r2_key,created_at)
      SELECT t.object_key,${at} FROM uploads t${parentIndex} WHERE ${expired}
      ON CONFLICT(r2_key) DO UPDATE SET created_at=excluded.created_at`);
    eligible = [];
    for (const row of rows) {
      try {
        if (row.multipart_id) {
          try { await requireResourceBindings("FILES_BUCKET").FILES_BUCKET.resumeMultipartUpload(String(row.object_key), String(row.multipart_id)).abort(); }
          catch (error) { if (!/not found|does not exist|10024|NoSuchUpload/i.test(String(error))) throw error; }
        }
        eligible.push(row);
      } catch (error) { console.error("Upload cleanup will retry", String(row.id), error instanceof Error ? error.name : "Unknown error"); }
    }
  }
  if (!eligible.length) return queries;
  const live = selected(task, eligible, before);
  if (task.intent && task.name !== "uploads") queries.push(sql`INSERT INTO object_gc(r2_key,created_at)
    SELECT ${sql.raw(`t.${task.intent}`)},${at} FROM ${table} t WHERE ${live} AND ${sql.raw(`t.${task.intent}`)} IS NOT NULL
    ON CONFLICT(r2_key) DO UPDATE SET created_at=excluded.created_at`);
  if (task.name === "changes") queries.push(sql`INSERT INTO change_watermarks
    SELECT t.owner_id,max(t.seq) FROM change_log t WHERE ${live} GROUP BY t.owner_id
    ON CONFLICT(owner_id) DO UPDATE SET floor=max(floor,excluded.floor)`);
  if (task.name === "devices") queries.push(sql`UPDATE api_tokens SET revoked_at=${at}
    WHERE id IN (SELECT t.api_token_id FROM device_codes t WHERE ${live} AND t.consumed_at IS NULL AND t.api_token_id IS NOT NULL)`);
  if (task.name === "secrets") queries.push(sql`UPDATE webhooks AS t SET previous_secret=NULL,previous_secret_until=NULL WHERE ${live}`);
  else if (task.child) {
    const [child, foreign, key] = task.child;
    // Independent child caps also bound FK cascade work. The final indexed
    // existence check runs inside this batch, after child deletion.
    for (const row of eligible) {
      const parent = selected(task, [row], before);
      if (child === "upload_parts") {
        // Compute the range from CURRENT children inside this same statement.
        // The unique (upload_id,part_number) index makes <= its first 25th key
        // retire at most 25 rows even with gaps or newly inserted lower parts.
        queries.push(sql`DELETE FROM upload_parts INDEXED BY sqlite_autoindex_upload_parts_1
          WHERE upload_id=${row[key]} AND part_number<=(SELECT max(part_number) FROM
            (SELECT part_number FROM upload_parts INDEXED BY sqlite_autoindex_upload_parts_1
              WHERE upload_id=${row[key]} ORDER BY part_number LIMIT ${CLEANUP_PAGE}))
          AND EXISTS(SELECT 1 FROM ${table} t${parentIndex} WHERE ${parent})`);
      } else queries.push(sql`DELETE FROM ${sql.raw(child)} WHERE rowid IN
        (SELECT rowid FROM ${sql.raw(child)} WHERE ${sql.raw(foreign)}=${row[key]} LIMIT ${CLEANUP_PAGE})
        AND EXISTS(SELECT 1 FROM ${table} t WHERE ${parent})`);
    }
    queries.push(sql`DELETE FROM ${table} AS t${parentIndex} WHERE ${live}
      AND NOT EXISTS(SELECT 1 FROM ${sql.raw(child)} WHERE ${sql.raw(foreign)}=t.${sql.raw(key)} LIMIT 1)`);
  } else queries.push(sql`DELETE FROM ${table} AS t WHERE ${live}`);
  return queries;
}

/** Hourly eligibility; active pages continue every minute. No source counts or
 * global candidate scans. Empty initial phases and off-hour idle turns write
 * nothing. One failed abort/large parent advances fairly and revisits on wrap. */
export async function cleanupTurn(startCycle: boolean, at = Date.now()) {
  const states = (await db.run(sql`SELECT task,cutoff,cursor_expiry,cursor_rowid,revision FROM resource_cleanup LIMIT 19`)).results as State[];
  if (!startCycle && !states.length) return { active: false, uploads: 0, recovery: 0 };
  const counts = { active: true, uploads: 0, recovery: 0 };
  for (const task of TASKS) {
    const state = states.find((row) => row.task === task.name);
    if (!startCycle && !state) continue;
    let before = state?.cutoff ?? cutoff(task, at);
    let rows = await page(task, before, state);
    if (!rows.length && state) {
      // Each traversal is finite under normal newer arrivals. On wrap, admit
      // newly expired rows as well as unfinished parents: one permanent abort
      // failure must not pin this task to an obsolete cutoff forever.
      const next = cutoff(task, at);
      if (next > before) before = next;
      rows = await page(task, before);
    }
    if (!rows.length) {
      if (state) await db.run(sql`DELETE FROM resource_cleanup WHERE task=${task.name} AND revision=${state.revision}`);
      continue;
    }
    const queries: SQL[] = [], last = rows.at(-1)!;
    if (task.table === "uploads") {
      // At most five parents; keep all statements in the original atomic batch.
      for (const row of rows) queries.push(...await mutations(task, [row], before, at));
    } else queries.push(...await mutations(task, rows, before, at));
    try {
      await atomicBatch([
        sql`INSERT INTO resource_cleanup_guard(id,valid) VALUES(1,CASE WHEN
          ${state ? sql`EXISTS(SELECT 1 FROM resource_cleanup WHERE task=${task.name} AND revision=${state.revision})`
            : sql`NOT EXISTS(SELECT 1 FROM resource_cleanup WHERE task=${task.name})`} THEN 1 ELSE 0 END)`,
        ...queries,
        sql`INSERT INTO resource_cleanup(task,cutoff,cursor_expiry,cursor_rowid,revision)
          VALUES(${task.name},${before},${last.expiry},${last.rid},${crypto.randomUUID()})
          ON CONFLICT(task) DO UPDATE SET cutoff=excluded.cutoff,cursor_expiry=excluded.cursor_expiry,cursor_rowid=excluded.cursor_rowid,revision=excluded.revision`,
        sql`DELETE FROM resource_cleanup_guard WHERE id=1`,
      ]);
      if (task.name === "uploads" || task.name === "recovery") counts[task.name] = rows.length;
    } catch (error) {
      // Another turn advanced this task while an R2 abort/read was in flight.
      // Its atomic batch won; never acknowledge or roll back its newer cursor.
      if (!String(error).includes("resource_cleanup_current")) throw error;
    }
  }
  return counts;
}
