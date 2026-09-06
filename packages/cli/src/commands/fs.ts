import { Command } from "commander";
import { AgfsClient } from "../lib/client";
import { renderAccountSummary, renderEntries, renderTree } from "../lib/format";

export function registerFsCommands(program: Command) {
  for (const reason of ["trash", "version"]) {
    program
      .command(reason === "trash" ? "trash" : "versions")
      .description("List retained files")
      .argument("[path]", "Remote path", "/")
      .action(async (path: string) => {
        const client = await AgfsClient.fromConfig();
        console.log(
          JSON.stringify(
            await (await client.request(`/api/v1/recovery?reason=${reason}&path=${encodeURIComponent(path)}`)).json(),
            null,
            2,
          ),
        );
      });
  }
  program
    .command("restore")
    .description("Restore a retained item to a vacant path")
    .argument("<id>")
    .argument("[path]")
    .action(async (id: string, path?: string) => {
      const client = await AgfsClient.fromConfig();
      console.log(
        await (
          await client.request("/api/v1/recovery/restore", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, path }),
          })
        ).json(),
      );
    });
  program
    .command("preview")
    .description("Create an isolated five-minute preview")
    .argument("<path>")
    .action(async (path: string) => {
      const client = await AgfsClient.fromConfig();
      console.log(
        (
          await (
            await client.request("/api/v1/fs/preview", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ path }),
            })
          ).json()
        ).url,
      );
    });
  program
    .command("activity")
    .description("List recent activity")
    .option("--cursor <cursor>", "Older activity cursor")
    .action(async (options: { cursor?: string }) => {
      const client = await AgfsClient.fromConfig();
      console.log(
        JSON.stringify(
          await (
            await client.request(
              `/api/v1/activity${options.cursor ? `?cursor=${encodeURIComponent(options.cursor)}` : ""}`,
            )
          ).json(),
          null,
          2,
        ),
      );
    });
  program
    .command("ls")
    .description("List the direct children at a remote path")
    .argument("[path]", "Remote path", "/")
    .action(async (pathname: string) => {
      const client = await AgfsClient.fromConfig();
      const result = await client.list(pathname);
      console.log(renderEntries(result.entries));
    });

  program
    .command("tree")
    .description("Render a tree view of a remote folder")
    .argument("[path]", "Remote path", "/")
    .action(async (pathname: string) => {
      const client = await AgfsClient.fromConfig();
      const result = await client.tree(pathname);
      console.log(renderTree(result.tree));
    });

  program
    .command("usage")
    .description("Show the current plan, storage usage, and remaining quota")
    .action(async () => {
      const client = await AgfsClient.fromConfig();
      const result = await client.account();
      console.log(renderAccountSummary(result));
    });

  program
    .command("mkdir")
    .description("Create a folder path")
    .argument("<path>", "Remote path")
    .action(async (pathname: string) => {
      const client = await AgfsClient.fromConfig();
      await client.mkdir(pathname);
      console.log(`Created ${pathname}`);
    });

  program
    .command("mv")
    .description("Move or rename a file or folder")
    .argument("<from>", "Current path")
    .argument("<to>", "Destination path")
    .action(async (from: string, to: string) => {
      const client = await AgfsClient.fromConfig();
      await client.move(from, to);
      console.log(`Moved ${from} -> ${to}`);
    });

  program
    .command("rm")
    .description("Delete a file or folder")
    .argument("<path>", "Remote path")
    .option("--recursive", "Delete folders recursively")
    .action(async (pathname: string, options: { recursive?: boolean }) => {
      const client = await AgfsClient.fromConfig();
      await client.remove(pathname, Boolean(options.recursive));
      console.log(`Removed ${pathname}`);
    });

  program
    .command("upload")
    .description("Upload a local file into AGFS")
    .argument("<localPath>", "Local file path")
    .argument("[remotePath]", "Remote destination path")
    .option("--share <ttl>", "Create a download link after upload")
    .action(async (localPath: string, remotePath: string | undefined, options: { share?: string }) => {
      const client = await AgfsClient.fromConfig();
      const destination = remotePath ?? `/${localPath.split("/").at(-1)}`;
      await client.upload(localPath, destination);
      console.log(`Uploaded ${destination}`);
      if (options.share) {
        const share = await client.share(destination, options.share);
        console.log(`Share URL: ${share.share.url}`);
      }
    });

  program
    .command("download")
    .description("Download a file or folder from AGFS")
    .argument("<remotePath>", "Remote file or folder path")
    .argument("[localPath]", "Destination path on disk")
    .action(async (remotePath: string, localPath?: string) => {
      const client = await AgfsClient.fromConfig();
      const destination = await client.download(remotePath, localPath);
      console.log(`Saved ${destination}`);
    });

  program
    .command("share")
    .description("Generate a download URL for a file")
    .argument("<remotePath>", "Remote file path")
    .option("--ttl <ttl>", "Link lifetime", "15m")
    .action(async (remotePath: string, options: { ttl: string }) => {
      const client = await AgfsClient.fromConfig();
      const result = await client.share(remotePath, options.ttl);
      console.log(result.share.url);
    });
}
