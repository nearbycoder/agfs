// Read-only build safety and source manifest. Run after the root's source-freeze GO.
// Does not install, clean, build, start a server, or read credential/config stores.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(".");
const outputs = ["packages/contracts/dist", "packages/db/dist", "packages/sdk/dist", "packages/cli/dist", "apps/web/dist", "apps/preview/dist", "apps/cimd-egress/dist"];
const inspected = [];
function inspect(path) {
  let stat;
  try { stat = lstatSync(path); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  assert(!stat.isSymbolicLink(), `Refusing clean build through output symlink: ${path}`);
  if (stat.isDirectory()) for (const entry of readdirSync(path)) inspect(join(path, entry));
}
for (const output of outputs) {
  let path = root;
  for (const segment of output.split("/")) {
    path = join(path, segment);
    try { assert(!lstatSync(path).isSymbolicLink(), `Refusing symlinked build-output ancestor: ${path}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  inspect(join(root, output)); inspected.push(output);
}
const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
  .split("\0").filter(Boolean).filter((path) =>
    /^(?:apps\/[^/]+\/src\/|packages\/[^/]+\/src\/|packages\/python-sdk\/(?:agfs_sdk|tests)\/|scripts\/|docs\/feature-expansion-|\.github\/workflows\/)/.test(path) ||
    /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|(?:vite|vitest|tsup)\.config\.[cm]?[jt]s|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(path));
const files = [];
for (const path of [...new Set(paths)].sort()) {
  if (path.includes("/__pycache__/")) continue;
  const stat = lstatSync(join(root, path));
  assert(stat.isFile() && !stat.isSymbolicLink(), `Source must be a regular file: ${path}`);
  files.push({ path, bytes: stat.size, sha256: createHash("sha256").update(readFileSync(join(root, path))).digest("hex") });
}
console.log(JSON.stringify({ capturedAt: new Date().toISOString(), root,
  baseline: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  node: process.version, inspectedOutputs: inspected, files }, null, 2));
