// Regenerate only when intentionally upgrading Better Auth's OAuth database schema.
import { writeFileSync } from "node:fs";
import { mcp } from "../apps/web/node_modules/@better-auth/mcp/dist/index.mjs";
import { jwt } from "../apps/web/node_modules/better-auth/dist/plugins/jwt/index.mjs";
const schemas = {
  ...mcp({
    loginPage: "/oauth/consent",
    consentPage: "/oauth/consent",
    resource: "https://agfs.dev/mcp",
  }).schema,
  ...jwt().schema,
};
const snake = (s) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
let ts =
  '// Generated from Better Auth 1.7.3 plugin schemas.\nimport {sqliteTable,text,integer} from "drizzle-orm/sqlite-core";\n';
let migration = "-- Better Auth OAuth 2.1 and JWT plugin storage.\n";
for (const [model, schema] of Object.entries(schemas)) {
  const table = snake(model),
    defs = ["id TEXT PRIMARY KEY NOT NULL"];
  ts += `export const ${model}=sqliteTable('${table}', {id:text('id').primaryKey(),\n`;
  for (const [name, f] of Object.entries(schema.fields)) {
    const col = snake(name),
      integerType = ["boolean", "date", "number"].includes(f.type);
    let t = integerType
      ? `integer('${col}'${f.type === "date" ? ', {mode:"timestamp_ms"}' : f.type === "boolean" ? ', {mode:"boolean"}' : ""})`
      : `text('${col}'${f.type === "json" || f.type === "string[]" ? ', {mode:"json"}' : ""})`;
    if (f.required !== false) t += ".notNull()";
    if (f.unique) t += ".unique()";
    ts += ` ${name}:${t},\n`;
    let d = `${col} ${integerType ? "INTEGER" : "TEXT"}${f.required !== false ? " NOT NULL" : ""}${f.unique ? " UNIQUE" : ""}`;
    if (f.references)
      d += ` REFERENCES ${f.references.model === "user" ? "user" : snake(f.references.model)}(${snake(f.references.field)}) ON DELETE ${(f.references.onDelete ?? "no action").toUpperCase()}`;
    defs.push(d);
  }
  ts += "});\n";
  migration += `CREATE TABLE ${table} (\n ${defs.join(",\n ")}\n);\n`;
  for (const [name, f] of Object.entries(schema.fields))
    if (f.index)
      migration += `CREATE INDEX ${table}_${snake(name)}_idx ON ${table}(${snake(name)});\n`;
  for (const i of schema.indexes ?? [])
    migration += `CREATE ${i.unique ? "UNIQUE " : ""}INDEX ${table}_${i.fields.map(snake).join("_")}_idx ON ${table}(${i.fields.map(snake).join(",")});\n`;
}
ts += `export const oauthSchema={${Object.keys(schemas).join(",")}};\n`;
writeFileSync(
  new URL("../packages/db/src/oauth-schema.ts", import.meta.url),
  ts,
);
writeFileSync(
  new URL("../packages/db/src/migrations/0005_oauth.sql", import.meta.url),
  migration,
);
