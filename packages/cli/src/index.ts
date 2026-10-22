#!/usr/bin/env node
import { Command } from "commander";
import { version } from "../package.json";
import { registerSyncCommands } from "./commands/sync";
import { registerAuthCommands } from "./commands/auth";
import { registerFsCommands } from "./commands/fs";
import { registerAutomationCommands } from "./commands/automation";
import { diagnoseError } from "@agfs/sdk";

const program = new Command()
  .name("agfs")
  .description("AgentFilesystem CLI")
  .version(version);

registerAuthCommands(program);
registerFsCommands(program);
registerSyncCommands(program);
registerAutomationCommands(program);
program.exitOverride().configureOutput({ writeErr: () => {} });

program.parseAsync(process.argv).catch((error: unknown) => {
  if ((error as { exitCode?: number; code?: string })?.exitCode === 0 && (error as { code?: string }).code?.startsWith("commander.")) return;
  const diagnostic = diagnoseError(error);
  console.error(program.opts().jsonErrors || process.argv.includes("--json-errors") ? JSON.stringify(diagnostic) : diagnostic.message);
  process.exitCode = diagnostic.exitCode;
});
