#!/usr/bin/env node
import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth";
import { registerFsCommands } from "./commands/fs";

const program = new Command().name("agfs").description("AgentFilesystem CLI").version("0.2.0");

registerAuthCommands(program);
registerFsCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
});
