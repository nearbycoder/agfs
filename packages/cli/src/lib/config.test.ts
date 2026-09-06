import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfigPath, readConfig, writeConfig } from "./config";

let tempDir = "";
const previousXdg = process.env.XDG_CONFIG_HOME;

describe("config persistence", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "agfs-cli-"));
    process.env.XDG_CONFIG_HOME = tempDir;
  });

  afterEach(async () => {
    process.env.XDG_CONFIG_HOME = previousXdg;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes and reads config from XDG config home", async () => {
    await writeConfig({ baseUrl: "https://example.com", token: "secret" });
    expect(getConfigPath()).toContain(tempDir);
    expect((await stat(getConfigPath())).mode & 0o777).toBe(0o600);
    await expect(readConfig()).resolves.toEqual({
      baseUrl: "https://example.com",
      token: "secret",
    });
  });
});

import { getResolvedToken } from "./config";
import { vi } from "vitest";
it("does not send a saved token to an overridden server", () => {
  vi.stubEnv("AGFS_BASE_URL", "https://other.example");
  vi.stubEnv("AGFS_TOKEN", "");
  try {
    expect(() => getResolvedToken({ baseUrl: "https://agfs.dev", token: "secret" })).toThrow("different server");
  } finally {
    vi.unstubAllEnvs();
  }
});
