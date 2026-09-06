import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface CliConfig {
  baseUrl?: string;
  token?: string;
}

function getConfigDir() {
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "agfs")
    : path.join(os.homedir(), ".config", "agfs");
}

export function getConfigPath() {
  return path.join(getConfigDir(), "config.json");
}

export async function readConfig(): Promise<CliConfig> {
  try {
    const content = await readFile(getConfigPath(), "utf8");
    return JSON.parse(content) as CliConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(config: CliConfig) {
  const filePath = getConfigPath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filePath), 0o700);
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function getResolvedBaseUrl(config: CliConfig) {
  return (process.env.AGFS_BASE_URL ?? config.baseUrl ?? "https://agfs.dev").replace(/\/+$/, "");
}

export function getResolvedToken(config: CliConfig) {
  if (process.env.AGFS_TOKEN) return process.env.AGFS_TOKEN;
  if (config.token && new URL(getResolvedBaseUrl(config)).origin !== new URL(config.baseUrl ?? "https://agfs.dev").origin) {
    throw new Error("Stored token belongs to a different server; log in to this server or set AGFS_TOKEN explicitly");
  }
  return config.token ?? null;
}
