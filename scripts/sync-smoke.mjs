import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  unlink,
  symlink,
  rm,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { AgfsClient } from "../packages/sdk/dist/index.js";
const local = await mkdtemp("/tmp/agfs-sync-smoke-"),
  remote = "/sync-" + Date.now(),
  client = new AgfsClient({
    token: "agfs_local_test_alice",
    baseUrl: "http://localhost:8787",
  });
let checks = 0;
const command = (...args) =>
  execFileSync(
    process.execPath,
    ["packages/cli/dist/index.js", "sync", local, remote, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AGFS_BASE_URL: "http://localhost:8787",
        AGFS_TOKEN: "agfs_local_test_alice",
      },
    },
  );
try {
  await client.mkdir(remote);
  await writeFile(local + "/local.txt", "first");
  await writeFile(local + "/.env", "never upload");
  const dry = command("--dry-run");
  assert(dry.includes("upload"));
  assert.equal((await client.list(remote)).entries.length, 0);
  checks += 2;
  command();
  assert.equal(await client.readText(remote + "/local.txt"), "first");
  assert(!(await client.list(remote)).entries.some((e) => e.name === ".env"));
  checks += 2;
  await client.upload(remote + "/remote.txt", new Blob(["from remote"]), {
    ifMatch: null,
  });
  command();
  assert.equal(await readFile(local + "/remote.txt", "utf8"), "from remote");
  checks++;
  await writeFile(local + "/local.txt", "second");
  command();
  assert.equal(await client.readText(remote + "/local.txt"), "second");
  checks++;
  await writeFile(local + "/local.txt", "local conflict");
  await client.upload(remote + "/local.txt", new Blob(["remote conflict"]));
  assert.throws(() => command(), /Sync found conflicts/);
  assert.equal(await readFile(local + "/local.txt", "utf8"), "local conflict");
  assert.equal(await client.readText(remote + "/local.txt"), "remote conflict");
  checks += 3;
  // Restore the tracked local version, then download the independent remote change.
  await writeFile(local + "/local.txt", "second");
  command();
  assert.equal(await readFile(local + "/local.txt", "utf8"), "remote conflict");
  checks++;
  await unlink(local + "/remote.txt");
  command();
  assert.equal(await client.readText(remote + "/remote.txt"), "from remote");
  command("--delete");
  assert(
    !(await client.list(remote)).entries.some((e) => e.name === "remote.txt"),
  );
  checks += 2;
  await symlink("/tmp", local + "/unsafe");
  assert.throws(() => command(), /refuses symlinks/);
  checks++;
  console.log("Sync + SDK smoke passed:", checks, "checks.");
} finally {
  await rm(local, { recursive: true, force: true });
  await client.remove(remote, true);
}
