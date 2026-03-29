import { Command } from "commander";
import { AgfsClient } from "../lib/client";
import { readConfig, writeConfig } from "../lib/config";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerAuthCommands(program: Command) {
  program
    .command("login")
    .description("Authenticate the CLI with device flow or a provided API token")
    .option("--token <token>", "Persist an existing AGFS API token")
    .option("--base-url <url>", "Override the AGFS base URL for this machine")
    .action(async (options: { token?: string; baseUrl?: string }) => {
      const config = await readConfig();
      const baseUrl = options.baseUrl ?? config.baseUrl ?? process.env.AGFS_BASE_URL ?? "https://agfs.dev";

      if (options.token) {
        await writeConfig({
          ...config,
          baseUrl,
          token: options.token,
        });
        console.log(`Stored AGFS token for ${baseUrl}`);
        return;
      }

      const client = new AgfsClient(baseUrl.replace(/\/+$/, ""), null);
      const start = await client.startDeviceLogin("agfs cli");
      console.log(`Open ${start.verificationUriComplete}`);
      console.log(`Code: ${start.userCode}`);

      while (true) {
        const result = await client.pollDeviceLogin(start.deviceCode);
        if (result.status === "approved") {
          await writeConfig({
            ...config,
            baseUrl,
            token: result.accessToken,
          });
          console.log("Login approved and token stored.");
          return;
        }
        if (result.status === "expired") {
          throw new Error("Device login expired before approval");
        }

        await sleep(result.intervalSeconds * 1000);
      }
    });

  program
    .command("logout")
    .description("Clear the locally stored AGFS token")
    .action(async () => {
      const config = await readConfig();
      await writeConfig({
        ...config,
        token: undefined,
      });
      console.log("Removed local AGFS token.");
    });

  program
    .command("whoami")
    .description("Show the current authenticated user")
    .action(async () => {
      const client = await AgfsClient.fromConfig();
      const result = await client.whoAmI();
      console.log(`${result.user.email} (${result.authSource})`);
    });
}
