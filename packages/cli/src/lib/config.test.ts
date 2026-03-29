import { mkdtemp, rm } from "node:fs/promises";
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
    await expect(readConfig()).resolves.toEqual({
      baseUrl: "https://example.com",
      token: "secret",
    });
  });
});
