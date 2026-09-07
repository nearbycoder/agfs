import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
const directory =
  (process.env.AGFS_TEST_STATE ?? "/tmp/agfs-audit-state") +
  "/v3/d1/miniflare-D1DatabaseObject";
export const database = new DatabaseSync(
  directory +
    "/" +
    readdirSync(directory).find(
      (n) => n.endsWith(".sqlite") && n !== "metadata.sqlite",
    ),
);
database.exec("PRAGMA busy_timeout=5000");
export function cookie(user = "alice") {
  const at = Date.now(),
    token = "platform-local-session-" + user;
  database
    .prepare(
      "INSERT OR REPLACE INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run(token, token, user, at + 86400000, at, at);
  const signed =
    token +
    "." +
    createHmac("sha256", "local-audit-only-secret-at-least-32-characters")
      .update(token)
      .digest("base64");
  return "better-auth.session_token=" + encodeURIComponent(signed);
}
