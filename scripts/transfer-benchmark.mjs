// Repeatable, network-free comparison of the SDK's sequential and parallel modes.
// Build @agfs/sdk first. These simulated latencies are not production throughput.
import { performance } from "node:perf_hooks";
import { AgfsClient } from "../packages/sdk/dist/index.js";

const partSize = 8 * 1024 * 1024;
const size = partSize * 6;
for (const concurrency of [1, 3]) {
  let reads = 0, active = 0, peak = 0, transferred = 0;
  const client = new AgfsClient({
    token: "local-benchmark-fixture",
    fetch: async (url) => {
      if (String(url).endsWith("/resumable"))
        return Response.json({ uploadId: "upl_benchmark", partSize, status: "pending", parts: [] });
      if (String(url).includes("/parts/")) {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 50));
        active--;
      }
      return Response.json({ entry: { path: "/benchmark" } });
    },
  });
  const started = performance.now();
  await client.uploadSource("/benchmark", {
    size,
    read: async (start, end) => { reads++; return new Uint8Array(end - start); },
  }, { concurrency, onProgress: (n) => { transferred = n; } });
  console.log(JSON.stringify({ concurrency, simulatedPartLatencyMs: 50, durationMs: Math.round(performance.now() - started), peakRequests: peak, sourceReads: reads, transferredBytes: transferred }));
}
