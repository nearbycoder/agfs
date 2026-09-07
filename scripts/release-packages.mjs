import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync("release", { recursive: true });
for (const pkg of ["sdk", "cli"]) {
  const p = JSON.parse(readFileSync(`packages/${pkg}/package.json`));
  execFileSync(
    "pnpm",
    ["pack", "--out", resolve(`release/agfs-${pkg}-${p.version}.tgz`)],
    { cwd: `packages/${pkg}`, stdio: "inherit" },
  );
  const tar = resolve(`release/agfs-${pkg}-${p.version}.tgz`),
    packed = JSON.parse(
      execFileSync("tar", ["-xOf", tar, "package/package.json"], {
        encoding: "utf8",
      }),
    );
  if (
    pkg === "cli" &&
    !["dist/index.js", "./dist/index.js"].includes(packed.bin?.agfs)
  )
    throw new Error("CLI executable missing from tarball");
  if (packed.version !== p.version) throw new Error("Packed version mismatch");
}
