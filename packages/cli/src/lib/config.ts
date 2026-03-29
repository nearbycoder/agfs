import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
  await chmod(filePath, 0o600);
}

export function getResolvedBaseUrl(config: CliConfig) {
  return (process.env.AGFS_BASE_URL ?? config.baseUrl ?? "https://agfs.dev").replace(/\/+$/, "");
}

export function getResolvedToken(config: CliConfig) {
  return process.env.AGFS_TOKEN ?? config.token ?? null;
}
