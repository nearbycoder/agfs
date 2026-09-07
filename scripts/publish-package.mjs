import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const kind = process.argv[2];
if (!["sdk", "cli"].includes(kind)) throw new Error("Choose sdk or cli");
const pkg = JSON.parse(readFileSync(`packages/${kind}/package.json`));
const tag = process.env.GITHUB_REF;
if (tag?.startsWith("refs/tags/") && tag !== `refs/tags/v${pkg.version}`)
  throw new Error("Release tag and package version differ");
const file = `./release/agfs-${kind}-${pkg.version}.tgz`;
const integrity =
  "sha512-" + createHash("sha512").update(readFileSync(file)).digest("base64");
const existing = spawnSync(
  "npm",
  ["view", `${pkg.name}@${pkg.version}`, "dist.integrity", "--json"],
  { encoding: "utf8" },
);
if (existing.status === 0) {
  if (JSON.parse(existing.stdout) !== integrity)
    throw new Error("This package version exists with different contents");
  console.log(
    `${pkg.name}@${pkg.version} already published with matching integrity`,
  );
} else {
  if (!existing.stderr.includes("E404"))
    throw new Error("Unable to verify registry state");
  execFileSync("npm", ["publish", file, "--access", "public", "--provenance"], {
    stdio: "inherit",
  });
}
