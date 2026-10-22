import type { Command } from "commander";
import { once } from "node:events";
import { AgfsClient as SDK, captureInventory, changeBatches, compareInventories, integer, mergeJsonPatch, publishText, readJsonLines, readLines, stageDraft, transformJson, validateInventory, type JsonValue } from "@agfs/sdk";
import { AgfsClient } from "../lib/client";
import { assertDurablePlatform, readLocal, readLocalJson, readPortableJson, writeLocalJson } from "../lib/automation-io";
import { exportInventory, uploadBundle } from "../lib/transfer-jobs";

/** Backpressure keeps NDJSON pipelines from retaining all records in stdout's queue. */
export async function outputJson(value: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!process.stdout.write(JSON.stringify(value) + "\n")) await once(process.stdout, "drain", { signal });
}
async function execute<T>(program: Command, work: (client: SDK) => Promise<T>): Promise<T> {
  const options = program.opts(), maxRequests = integer(Number(options.maxRequests), "maxRequests", 1, 10000), timeoutMs = integer(Number(options.timeoutMs), "timeoutMs", 1, 3600000);
  const resolved = await AgfsClient.fromConfig(); if (!resolved.token) throw Object.assign(new Error("Sign in first with agfs login"), { status: 401 });
  const controller = new AbortController(), stop = () => controller.abort(new DOMException("Command cancelled", "AbortError"));
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { return await new SDK({ token: resolved.token, baseUrl: resolved.baseUrl }).withScope({ maxRequests, timeoutMs, signal: controller.signal }, work); }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
export function registerAutomationCommands(program: Command) {
  program.option("--json-errors", "Write structured errors to stderr with stable exit codes")
    .option("--max-requests <count>", "Automation transport attempt budget, including retries (1–10000)", "100")
    .option("--timeout-ms <milliseconds>", "Automation operation deadline, including body reads (1–3600000)", "30000");
  const inventory = program.command("inventory").description("Capture bounded file inventories or compare them offline");
  inventory.command("capture <remote>").description("Capture scoped metadata to a protected local file (Linux /proc/self/fd)")
    .requiredOption("--out <file>", "Local inventory JSON file (Linux)")
    .option("--max-entries <count>", "Maximum discovered entries (1–10000)", "10000")
    .option("--max-folders <count>", "Maximum visited folders", "1000")
    .option("--max-depth <count>", "Maximum folder descent depth", "16")
    .action(async (remote, options) => { await assertDurablePlatform(); return execute(program, async client => {
      const manifest = await captureInventory(client, remote, { maxEntries: Number(options.maxEntries), maxFolders: Number(options.maxFolders), maxDepth: Number(options.maxDepth) });
      await writeLocalJson(options.out, manifest); await outputJson({ inventory: options.out, entries: manifest.entries.length });
    }); });
  inventory.command("diff <before> <after>").description("Emit added/removed/changed/unchanged NDJSON; no network")
    .action(async (before, after) => { for (const difference of compareInventories(validateInventory(await readPortableJson(before)), validateInventory(await readPortableJson(after)))) await outputJson(difference); });
  program.command("export <inventory> <local>").description("Resume an ETag-pinned inventory backup with validated checkpoints (Linux)")
    .option("--max-bytes <bytes>", "Maximum total declared file bytes", "1073741824")
    .action(async (manifest, local, options) => { await assertDurablePlatform(); return execute(program, async client => outputJson(await exportInventory(client, await readLocalJson(manifest), local, { maxBytes: Number(options.maxBytes) }), client.signal)); });
  const bundle = program.command("bundle").description("Plan or resume an explicit conditional upload bundle");
  bundle.command("upload <manifest> <local>").description("Validate every source/destination, then upload sequentially (Linux)")
    .option("--dry-run", "Hash and print a local plan; no authentication or network")
    .option("--max-bytes <bytes>", "Maximum sum of source file sizes", "1073741824")
    .action(async (manifest, local, options) => {
      await assertDurablePlatform();
      const input = await readLocalJson(manifest), job = { dryRun: options.dryRun, maxBytes: Number(options.maxBytes) };
      if (options.dryRun) await outputJson(await uploadBundle(new SDK({ token: "offline" }), input, local, job));
      else await execute(program, async client => outputJson(await uploadBundle(client, input, local, job)));
    });
  for (const records of [false, true]) {
    program.command(records ? "records <remote>" : "lines <remote>")
      .description(records ? "Stream validated JSONL records with resumable byte checkpoints" : "Stream strict UTF-8 lines with resumable byte checkpoints")
      .option("--checkpoint <file>", "Read a prior emitted checkpoint JSON (Linux)")
      .option("--max-bytes <bytes>", "Maximum requested file bytes", "8388608")
      .option("--max-line-bytes <bytes>", "Maximum line length in bytes", "65536")
      .option("--max-records <count>", "Maximum lines/records", "10000")
      .action(async (remote, options) => execute(program, async client => {
        const settings = { checkpoint: options.checkpoint ? await readLocalJson(options.checkpoint) : undefined, maxBytes: Number(options.maxBytes), maxLineBytes: Number(options.maxLineBytes), maxLines: Number(options.maxRecords), maxRecords: Number(options.maxRecords) };
        if (records) { for await (const row of readJsonLines(client, remote, settings)) await outputJson(row, client.signal); }
        else { for await (const row of readLines(client, remote, settings)) await outputJson(row, client.signal); }
      }));
  }
  const text = program.command("text").description("Publish bounded UTF-8 documents without redundant writes");
  text.command("publish <local> <remote>").description("Skip identical content; create/update conditionally against the observed version")
    .option("--max-bytes <bytes>", "Maximum local/current remote document bytes", "1048576")
    .option("--content-type <type>", "Override content type")
    .action(async (local, remote, options) => {
      const maxBytes = integer(Number(options.maxBytes), "maxBytes", 1, 8388608), content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readLocal(local, maxBytes));
      await execute(program, async client => outputJson(await publishText(client, remote, content, { maxBytes, contentType: options.contentType })));
    });
  const json = program.command("json").description("Conditionally transform remote JSON documents");
  json.command("patch <remote> <patch>").description("Apply a local RFC 7396 merge patch once; null removes object members")
    .option("--max-bytes <bytes>", "Maximum input/result bytes", "1048576")
    .action(async (remote, patch, options) => {
      const maxBytes = integer(Number(options.maxBytes), "maxBytes", 1, 8388608), value = await readLocalJson(patch, maxBytes) as JsonValue;
      await execute(program, async client => outputJson(await transformJson(client, remote, current => mergeJsonPatch(current, value), { maxBytes })));
    });
  program.command("changes <remote>").description("Emit finite change batches; persist each checkpoint only after accepting its batch")
    .option("--checkpoint <file>", "Read a saved checkpoint; emitted checkpoints can be saved for the next run")
    .option("--since <sequence>", "Initial sequence; omission captures the current watermark")
    .option("--max-pages <count>", "Maximum pages in this invocation", "100")
    .action(async (remote, options) => execute(program, async client => {
      for await (const batch of changeBatches(client, remote, { checkpoint: options.checkpoint ? await readLocalJson(options.checkpoint) : undefined, since: options.since === undefined ? undefined : Number(options.since), maxPages: Number(options.maxPages) })) await outputJson(batch, client.signal);
    }));
  program.command("draft").description("Stage declarative changes for human review")
    .command("stage <manifest>").description("Prevalidate 1–30 changes, then stage sequentially; never approves or applies")
    .action(async manifest => { const batch = await readLocalJson(manifest, 1048576); await execute(program, async client => outputJson(await stageDraft(client, batch))); });
}
