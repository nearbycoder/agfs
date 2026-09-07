#!/usr/bin/env node
import { Command } from "commander";
import { version } from "../package.json";
import { registerSyncCommands } from "./commands/sync";
import { registerAuthCommands } from "./commands/auth";
import { registerFsCommands } from "./commands/fs";

const program = new Command()
  .name("agfs")
  .description("AgentFilesystem CLI")
  .version(version);

registerAuthCommands(program);
registerFsCommands(program);
registerSyncCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
});
